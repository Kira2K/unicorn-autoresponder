import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProfileFillerNocoRepository } from './noco-repository.ts'
import { createDriveSourceLoader } from './drive-source.ts'
import { createCvExtractor } from './cv-extractor.ts'
import { buildPreparedProfile } from './profile-builder.ts'
import { errorCode, errorStage, ProfileFillerError, safeErrorMessage } from './errors.ts'
import { withAuthorizedHHPage } from './hh-session.ts'
import { configurePrivacyAndStopList, createResumeDraft, deleteResume, inspectHH,
  listResumes, type ResumeSnapshot } from './hh-resume-ui.ts'
import type { PreparedProfile, ProfileFillerMarket, ProfileFillerResult } from './types.ts'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function artifactRoot(): string {
  return process.env.PROFILE_FILLER_ARTIFACT_ROOT
    ? path.resolve(process.env.PROFILE_FILLER_ARTIFACT_ROOT)
    : path.resolve(moduleDir, '../../../logs/hh-profile-filler')
}

function writeJson(name: string, value: unknown): string {
  const directory = artifactRoot()
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, name)
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  return file
}

function sanitizedPlan(profile: PreparedProfile) {
  return {
    client: {
      clientId: profile.client.clientId,
      clientName: profile.client.clientName,
      market: profile.client.market,
      stack: profile.client.stack,
      dolphinProfileId: profile.client.dolphinProfileId,
      cvRevision: profile.client.cvRevision
    },
    titles: profile.titles,
    sections: {
      experience: profile.cv.experience.length,
      education: profile.cv.education.length,
      languages: profile.cv.languages.length,
      skills: profile.cv.skills.length,
      hasAbout: Boolean(profile.about),
      hasEmail: Boolean(profile.cv.contacts.email),
      hasPhone: Boolean(profile.cv.contacts.phone)
    },
    employerCandidates: profile.employerCandidates,
    preparedAt: profile.preparedAt
  }
}

export function createProfileFillerService(options: {
  repository?: ReturnType<typeof createProfileFillerNocoRepository>
  drive?: ReturnType<typeof createDriveSourceLoader>
  extractor?: ReturnType<typeof createCvExtractor>
  withPage?: typeof withAuthorizedHHPage
  ui?: {
    configurePrivacyAndStopList: typeof configurePrivacyAndStopList
    createResumeDraft: typeof createResumeDraft
    deleteResume: typeof deleteResume
    inspectHH: typeof inspectHH
    listResumes: typeof listResumes
  }
} = {}) {
  const repository = options.repository ?? createProfileFillerNocoRepository()
  const drive = options.drive ?? createDriveSourceLoader()
  let extractor = options.extractor
  const withPage = options.withPage ?? withAuthorizedHHPage
  const ui = options.ui ?? { configurePrivacyAndStopList, createResumeDraft, deleteResume,
    inspectHH, listResumes }

  async function prepare(clientId: number, market: ProfileFillerMarket): Promise<PreparedProfile> {
    const client = await repository.resolveClient(clientId, market)
    const cv = await drive.loadCv(client.cvUrl)
    const selfPresentations = await drive.loadSelfPresentations(client.studentFolderUrl)
    extractor ??= createCvExtractor()
    const extracted = await extractor.extract([cv, ...selfPresentations], market)
    return buildPreparedProfile(client, extracted)
  }

  async function dryRun(profile: PreparedProfile, jobId?: string): Promise<ProfileFillerResult> {
    const planArtifact = writeJson(
      `prepared-${profile.client.clientId}-${profile.client.market.toLowerCase()}-${Date.now()}.json`,
      sanitizedPlan(profile)
    )
    const inspected = await withPage(profile.client, async (page, artifactDir) => {
      const result = await ui.inspectHH(page, artifactDir)
      return { ...result, artifactDir }
    })
    return {
      ok: true,
      dryRun: true,
      jobId,
      clientId: profile.client.clientId,
      clientName: profile.client.clientName,
      market: profile.client.market,
      dolphinProfileId: profile.client.dolphinProfileId,
      stage: 'dry_run_passed',
      message: `Dry-run passed; ${inspected.resumes.length} existing resume(s), ` +
        `${profile.titles.length} target draft(s).`,
      artifactDir: path.dirname(inspected.artifact || planArtifact)
    }
  }

  async function execute(profile: PreparedProfile, jobId?: string): Promise<ProfileFillerResult> {
    return await withPage(profile.client, async (page, artifactDir) => {
      const oldResumes = await ui.listResumes(page)
      const snapshotFile = path.join(artifactDir, 'old-resumes.json')
      fs.writeFileSync(snapshotFile, `${JSON.stringify(oldResumes, null, 2)}\n`, { mode: 0o600 })
      const created: ResumeSnapshot[] = []
      const deleted: ResumeSnapshot[] = []
      try {
        for (const title of profile.titles) {
          try {
            created.push(await ui.createResumeDraft(page, profile, title, artifactDir))
          } catch (error) {
            if (error instanceof ProfileFillerError && error.code === 'profile_hh_resume_limit') {
              const replacement = oldResumes.find(item =>
                !deleted.some(removed => removed.id === item.id))
              if (!replacement) throw error
              await ui.deleteResume(page, replacement)
              deleted.push(replacement)
              created.push(await ui.createResumeDraft(page, profile, title, artifactDir))
            } else throw error
          }
        }

        const stopList = { added: [] as string[], existing: [] as string[],
          skipped: [] as Array<{ name: string; reason: string }> }
        for (const resume of created) {
          const result = await ui.configurePrivacyAndStopList(page, resume, profile)
          stopList.added.push(...result.added)
          stopList.existing.push(...result.existing)
          stopList.skipped.push(...result.skipped)
        }

        for (const resume of oldResumes) {
          if (!deleted.some(item => item.id === resume.id)) {
            await ui.deleteResume(page, resume)
            deleted.push(resume)
          }
        }
        const finalResumes = await ui.listResumes(page)
        const finalIds = new Set(finalResumes.map(item => item.id))
        const missing = created.filter(item => !finalIds.has(item.id))
        const survivors = oldResumes.filter(item => finalIds.has(item.id))
        const published = finalResumes.filter(item =>
          created.some(createdResume => createdResume.id === item.id) && !item.isDraft)
        const titles = new Set(finalResumes.filter(item =>
          created.some(createdResume => createdResume.id === item.id)).map(item => item.title.trim()))
        const missingTitles = profile.titles.filter(title => !titles.has(title.trim()))
        if (missing.length || survivors.length || published.length || missingTitles.length) {
          throw new ProfileFillerError('profile_hh_final_verification_failed',
            `Final HH verification failed: ${missing.length} new drafts missing, ` +
            `${survivors.length} old resumes remain, ${published.length} unexpectedly published, ` +
            `${missingTitles.length} titles missing.`, 'verify')
        }
        await page.screenshot({ path: path.join(artifactDir, 'final-resumes.png'), fullPage: true })
        const result: ProfileFillerResult = {
          ok: true,
          dryRun: false,
          jobId,
          clientId: profile.client.clientId,
          clientName: profile.client.clientName,
          market: profile.client.market,
          dolphinProfileId: profile.client.dolphinProfileId,
          stage: 'completed',
          message: `Created ${created.length} HH draft(s) and removed ${deleted.length} old resume(s).`,
          artifactDir,
          createdResumeTitles: created.map(item => item.title),
          deletedResumeIds: deleted.map(item => item.id),
          stopList: {
            added: [...new Set(stopList.added)],
            existing: [...new Set(stopList.existing)],
            skipped: stopList.skipped.filter((item, index, rows) =>
              rows.findIndex(candidate => candidate.name === item.name &&
                candidate.reason === item.reason) === index)
          }
        }
        fs.writeFileSync(path.join(artifactDir, 'result.json'),
          `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
        return result
      } catch (error) {
        if (deleted.length && !(error instanceof ProfileFillerError &&
          error.code === 'profile_hh_critical_partial_deletion')) {
          throw new ProfileFillerError('profile_hh_critical_partial_deletion',
            `Critical: ${deleted.length} old resume(s) were deleted before failure: ` +
            safeErrorMessage(error), 'replace_resumes', {
              deletedResumeIds: deleted.map(item => item.id)
            })
        }
        throw error
      }
    })
  }

  async function run(clientId: number, market: ProfileFillerMarket,
    dryRunOnly = false, jobId?: string): Promise<ProfileFillerResult> {
    try {
      const prepared = await prepare(clientId, market)
      const checked = await dryRun(prepared, jobId)
      return dryRunOnly ? checked : await execute(prepared, jobId)
    } catch (error) {
      return {
        ok: false, dryRun: dryRunOnly, jobId, clientId, clientName: `client-${clientId}`, market,
        stage: errorStage(error), code: errorCode(error), message: safeErrorMessage(error)
      }
    }
  }

  return { dryRun, execute, prepare, run, repository }
}

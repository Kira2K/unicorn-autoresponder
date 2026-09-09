import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProfileFillerNocoRepository } from './noco-repository.ts'
import { createDriveSourceLoader } from './drive-source.ts'
import { createCvExtractor } from './cv-extractor.ts'
import { buildPreparedProfile } from './profile-builder.ts'
import { errorCode, errorStage, ProfileFillerError, safeErrorMessage } from './errors.ts'
import { withAuthorizedHHPage } from './hh-session.ts'
import { captureArtifactScreenshot, configurePrivacyAndStopList, createResumeDraft, deleteResume,
  duplicateResumeVariant, INITIAL_HH_PROFESSION,
  inspectHH, listResumes, professionForTitle, resumeDraftFromWorkPermits,
  verifyKnownDraft, type ResumeSnapshot } from './hh-resume-ui.ts'
import type { PreparedProfile, ProfileFillerMarket, ProfileFillerResult, ResolvedClient } from './types.ts'

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

function requiredPositiveEnv(name: string): number {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value <= 0) {
    throw new ProfileFillerError('profile_live_smoke_not_configured',
      `Set ${name} to the dedicated test target before running live smoke.`,
      'live_smoke_guard')
  }
  return value
}

export function assertLiveSmokeTarget(client: ResolvedClient): void {
  const clientId = requiredPositiveEnv('PROFILE_FILLER_SMOKE_CLIENT_ID')
  const dolphinProfileId = requiredPositiveEnv('PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID')
  if (client.clientId !== clientId || client.dolphinProfileId !== dolphinProfileId) {
    throw new ProfileFillerError('profile_live_smoke_target_mismatch',
      'Resolved Noco client and Dolphin profile do not match the dedicated live-smoke allowlist.',
      'live_smoke_guard', {
        resolvedClientId: client.clientId,
        resolvedDolphinProfileId: client.dolphinProfileId
      })
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
    duplicateResumeVariant: typeof duplicateResumeVariant
    inspectHH: typeof inspectHH
    listResumes: typeof listResumes
    resumeDraftFromWorkPermits: typeof resumeDraftFromWorkPermits
    verifyKnownDraft: typeof verifyKnownDraft
  }
} = {}) {
  const repository = options.repository ?? createProfileFillerNocoRepository()
  const drive = options.drive ?? createDriveSourceLoader()
  let extractor = options.extractor
  const withPage = options.withPage ?? withAuthorizedHHPage
  const ui = options.ui ?? { configurePrivacyAndStopList, createResumeDraft, deleteResume,
    duplicateResumeVariant, inspectHH, listResumes, resumeDraftFromWorkPermits, verifyKnownDraft }

  async function prepareResolved(client: ResolvedClient,
    useNocoIdentity = false): Promise<PreparedProfile> {
    const cv = await drive.loadCv(client.cvUrl)
    const experienceDescriptions = await drive.loadExperienceDescriptions(client.studentFolderUrl)
    extractor ??= createCvExtractor()
    const extracted = await extractor.extract([cv, ...experienceDescriptions], client.market)
    return buildPreparedProfile(client, extracted, new Date().toISOString(), { useNocoIdentity })
  }

  async function prepare(clientId: number, market: ProfileFillerMarket,
    useNocoIdentity = false): Promise<PreparedProfile> {
    return await prepareResolved(await repository.resolveClient(clientId, market), useNocoIdentity)
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

  async function liveSmoke(profile: PreparedProfile, jobId?: string): Promise<ProfileFillerResult> {
    assertLiveSmokeTarget(profile.client)
    const smokeTitle = profile.titles[0]
    if (!smokeTitle) throw new ProfileFillerError('profile_live_smoke_title_missing',
      'Prepared test profile has no mapped resume title for live smoke.', 'live_smoke_guard')
    return await withPage(profile.client, async (page, artifactDir) => {
      const before = await ui.listResumes(page)
      const beforeIds = new Set(before.map(item => item.id))
      fs.writeFileSync(path.join(artifactDir, 'live-smoke-before.json'),
        `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 })

      let created: ResumeSnapshot | undefined
      let smokeError: unknown
      const deletedIds: string[] = []
      try {
        created = await ui.createResumeDraft(page, profile, smokeTitle, artifactDir)
        const afterWizard = await ui.listResumes(page)
        const listed = afterWizard.find(item => item.id === created?.id)
        if (!created.id || beforeIds.has(created.id) || !listed || !listed.isDraft) {
          throw new ProfileFillerError('profile_live_smoke_verification_failed',
            'Live smoke did not expose a new, unpublished HH draft after traversing the wizard.',
            'live_smoke_verify')
        }
        await captureArtifactScreenshot(page,
          path.join(artifactDir, 'live-smoke-wizard-passed.png'))
      } catch (error) {
        smokeError = error
      }

      let cleanupError: unknown
      try {
        const current = await ui.listResumes(page)
        const createdDuringSmoke = current.filter(item => !beforeIds.has(item.id))
        for (const resume of createdDuringSmoke) {
          await ui.deleteResume(page, resume)
          deletedIds.push(resume.id)
        }
        const remaining = await ui.listResumes(page)
        const leaked = remaining.filter(item => !beforeIds.has(item.id))
        if (leaked.length) {
          throw new ProfileFillerError('profile_live_smoke_cleanup_failed',
            `Live smoke cleanup left ${leaked.length} temporary resume(s).`,
            'live_smoke_cleanup', { leakedResumeIds: leaked.map(item => item.id) })
        }
      } catch (error) {
        cleanupError = error
      }

      if (cleanupError) {
        throw new ProfileFillerError('profile_live_smoke_cleanup_failed',
          `Live smoke cleanup failed: ${safeErrorMessage(cleanupError)}`,
          'live_smoke_cleanup', {
            createdResumeId: created?.id,
            originalFailure: smokeError ? safeErrorMessage(smokeError) : undefined
          })
      }
      if (smokeError) throw smokeError

      const result: ProfileFillerResult = {
        ok: true,
        dryRun: true,
        jobId,
        clientId: profile.client.clientId,
        clientName: profile.client.clientName,
        market: profile.client.market,
        dolphinProfileId: profile.client.dolphinProfileId,
        stage: 'live_smoke_passed',
        message: 'Live smoke traversed the HH wizard without publishing and removed its temporary draft.',
        artifactDir,
        createdResumeTitles: created ? [created.title] : [],
        deletedResumeIds: deletedIds
      }
      fs.writeFileSync(path.join(artifactDir, 'live-smoke-result.json'),
        `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
      return result
    })
  }

  async function execute(profile: PreparedProfile, jobId?: string,
    executionOptions: { preserveExisting?: boolean;
      resumeIdsByTitle?: Record<string, string>;
      resumeFrom?: 'work-permits' | 'privacy' | 'delete-old' | 'verify-final' } = {}): Promise<ProfileFillerResult> {
    const preserveExisting = executionOptions.preserveExisting === true
    return await withPage(profile.client, async (page, artifactDir) => {
      const oldResumes = await ui.listResumes(page)
      const snapshotFile = path.join(artifactDir, 'old-resumes.json')
      fs.writeFileSync(snapshotFile, `${JSON.stringify(oldResumes, null, 2)}\n`, { mode: 0o600 })
      const created: ResumeSnapshot[] = []
      const duplicated: ResumeSnapshot[] = []
      const deleted: ResumeSnapshot[] = []
      const targets: ResumeSnapshot[] = []
      try {
        const baselineTitle = professionForTitle(profile.titles[0], profile.client.market).trim()
        const baseline = oldResumes.find(item => !item.isDraft && item.title.trim() === baselineTitle)
        const initialProfessionDrafts = oldResumes.filter(item => item.isDraft &&
          item.title.trim() === INITIAL_HH_PROFESSION)
        for (const title of profile.titles) {
          const profession = professionForTitle(title, profile.client.market).trim()
          const existing = oldResumes.find(item => !deleted.some(removed => removed.id === item.id) &&
            item.title.trim() === profession)
          if (executionOptions.resumeFrom === 'verify-final') {
            const knownId = executionOptions.resumeIdsByTitle?.[title]
            if (!knownId) throw new ProfileFillerError('profile_hh_final_resume_id_missing',
              `Final verification requires a known ID for "${profession}".`, 'verify_draft')
            targets.push(await ui.verifyKnownDraft(page, profession, knownId, artifactDir))
            continue
          }
          if (executionOptions.resumeFrom === 'privacy' ||
              executionOptions.resumeFrom === 'delete-old') {
            if (!existing?.isDraft) throw new ProfileFillerError(
              'profile_hh_recovery_draft_missing',
              `Recovery requires an unpublished draft titled "${profession}".`,
              executionOptions.resumeFrom === 'privacy' ? 'configure_privacy' : 'verify_draft')
            targets.push(existing)
            continue
          }
          if (existing && !existing.isDraft) {
            targets.push(existing)
            continue
          }
          const resumeDraftId = executionOptions.resumeIdsByTitle?.[title] ?? existing?.id ??
            initialProfessionDrafts.shift()?.id
          try {
            const resume = resumeDraftId && executionOptions.resumeFrom === 'work-permits' &&
                executionOptions.resumeIdsByTitle?.[title] === resumeDraftId
              ? await ui.resumeDraftFromWorkPermits(page, profile, title, resumeDraftId)
              : resumeDraftId
              ? await ui.createResumeDraft(page, profile, title, artifactDir,
                  resumeDraftId)
              : baseline
                ? await ui.duplicateResumeVariant(page, baseline, title, profile.client.stack,
                    profile.client.market)
                : await ui.createResumeDraft(page, profile, title, artifactDir)
            created.push(resume)
            targets.push(resume)
            if (baseline && !resume.isDraft) duplicated.push(resume)
          } catch (error) {
            if (error instanceof ProfileFillerError && error.code === 'profile_hh_resume_limit') {
              if (preserveExisting) throw error
              const replacement = oldResumes.find(item =>
                item.id !== baseline?.id && item.id !== existing?.id &&
                !targets.some(target => target.id === item.id) &&
                !deleted.some(removed => removed.id === item.id))
              if (!replacement) throw error
              await ui.deleteResume(page, replacement)
              deleted.push(replacement)
              const retryDraftId = executionOptions.resumeIdsByTitle?.[title] ?? existing?.id ??
                initialProfessionDrafts.shift()?.id
              const resume = retryDraftId && executionOptions.resumeFrom === 'work-permits' &&
                  executionOptions.resumeIdsByTitle?.[title] === retryDraftId
                ? await ui.resumeDraftFromWorkPermits(page, profile, title, retryDraftId)
                : retryDraftId
                ? await ui.createResumeDraft(page, profile, title, artifactDir,
                    retryDraftId)
                : baseline
                  ? await ui.duplicateResumeVariant(page, baseline, title, profile.client.stack,
                      profile.client.market)
                  : await ui.createResumeDraft(page, profile, title, artifactDir)
              created.push(resume)
              targets.push(resume)
              if (baseline && !resume.isDraft) duplicated.push(resume)
            } else throw error
          }
        }

        const stopList = { added: [] as string[], existing: [] as string[],
          skipped: [] as Array<{ name: string; reason: string }> }
        if (executionOptions.resumeFrom !== 'delete-old' &&
            executionOptions.resumeFrom !== 'verify-final') {
          for (const resume of targets) {
            const result = await ui.configurePrivacyAndStopList(page, resume, profile)
            stopList.added.push(...result.added)
            stopList.existing.push(...result.existing)
            stopList.skipped.push(...result.skipped)
          }
        }

        if (!preserveExisting && executionOptions.resumeFrom !== 'verify-final') {
          for (const resume of oldResumes) {
            if (!deleted.some(item => item.id === resume.id) &&
                !targets.some(item => item.id === resume.id)) {
              await ui.deleteResume(page, resume)
              deleted.push(resume)
            }
          }
        }
        const finalResumes = executionOptions.resumeFrom === 'verify-final'
          ? targets : await ui.listResumes(page)
        const finalIds = new Set(finalResumes.map(item => item.id))
        const missing = targets.filter(item => !finalIds.has(item.id))
        const survivors = preserveExisting ? [] : oldResumes.filter(item =>
          finalIds.has(item.id) && !targets.some(target => target.id === item.id))
        const published = finalResumes.filter(item =>
          targets.some(target => target.id === item.id) &&
          (executionOptions.resumeFrom === 'privacy' ||
            executionOptions.resumeFrom === 'delete-old' ||
            created.some(createdResume => createdResume.id === item.id)) && !item.isDraft &&
          !duplicated.some(duplicate => duplicate.id === item.id))
        const titles = new Set(finalResumes.filter(item =>
          targets.some(target => target.id === item.id)).map(item => item.title.trim()))
        const missingTitles = profile.titles.filter(title =>
          !titles.has(professionForTitle(title, profile.client.market).trim()))
        if (missing.length || survivors.length || published.length || missingTitles.length) {
          throw new ProfileFillerError('profile_hh_final_verification_failed',
            `Final HH verification failed: ${missing.length} new drafts missing, ` +
            `${survivors.length} old resumes remain, ${published.length} unexpectedly published, ` +
            `${missingTitles.length} titles missing.`, 'verify')
        }
        await captureArtifactScreenshot(page, path.join(artifactDir, 'final-resumes.png'))
        const result: ProfileFillerResult = {
          ok: true,
          dryRun: false,
          jobId,
          clientId: profile.client.clientId,
          clientName: profile.client.clientName,
          market: profile.client.market,
          dolphinProfileId: profile.client.dolphinProfileId,
          stage: 'completed',
          message: executionOptions.resumeFrom === 'delete-old'
            ? `Removed ${deleted.length} old resume(s) after verified recovery of ` +
              `${targets.length} target draft(s).`
            : executionOptions.resumeFrom === 'verify-final'
              ? `Verified ${targets.length} unpublished HH draft(s) by their known IDs.`
            : executionOptions.resumeFrom === 'privacy'
            ? `Completed privacy for ${targets.length} HH draft(s) and removed ` +
              `${deleted.length} old resume(s).`
            : preserveExisting
            ? `Created ${created.length} HH resume variant(s); existing resumes were preserved.`
            : `Created ${created.length} HH resume variant(s) and removed ${deleted.length} old resume(s).`,
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
    dryRunOnly = false, jobId?: string, useNocoIdentity = false,
    resumeId?: string,
    resumeFrom?: 'work-permits' | 'privacy' | 'delete-old' | 'verify-final',
    orderedResumeIds: string[] = []): Promise<ProfileFillerResult> {
    let clientName = `client-${clientId}`
    try {
      const client = await repository.resolveClient(clientId, market)
      clientName = client.clientName
      const prepared = await prepareResolved(client, useNocoIdentity)
      if (orderedResumeIds.length && orderedResumeIds.length !== prepared.titles.length) {
        throw new ProfileFillerError('profile_hh_final_resume_id_count',
          `Expected ${prepared.titles.length} ordered resume IDs, got ${orderedResumeIds.length}.`,
          'verify_draft')
      }
      const resumeIdsByTitle = orderedResumeIds.length
        ? Object.fromEntries(prepared.titles.map((title, index) => [title, orderedResumeIds[index]]))
        : resumeId && prepared.titles[0]
          ? { [prepared.titles[0]]: resumeId }
          : undefined
      // --resume-id is a recovery path for a draft whose initial headful dry-run
      // already passed. Starting the new-resume wizard again adds risk and can
      // interfere with that resumable draft, so continue it directly.
      if ((resumeId || resumeFrom) && !dryRunOnly) {
        return await execute(prepared, jobId, { resumeIdsByTitle, resumeFrom })
      }
      const checked = await dryRun(prepared, jobId)
      return dryRunOnly ? checked : await execute(prepared, jobId,
        { resumeIdsByTitle, resumeFrom })
    } catch (error) {
      const errorArtifactDir = error instanceof ProfileFillerError &&
        typeof error.details?.artifactDir === 'string' ? error.details.artifactDir : undefined
      const result: ProfileFillerResult = {
        ok: false, dryRun: dryRunOnly, jobId, clientId, clientName, market,
        stage: errorStage(error), code: errorCode(error), message: safeErrorMessage(error),
        artifactDir: errorArtifactDir
      }
      if (errorArtifactDir) {
        fs.writeFileSync(path.join(errorArtifactDir, 'result.json'),
          `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
      } else {
        const directory = artifactRoot()
        result.artifactDir = directory
        writeJson(`result-failure-${clientId}-${market.toLowerCase()}-${Date.now()}.json`, result)
      }
      return result
    }
  }

  async function runLiveSmoke(clientId: number,
    market: ProfileFillerMarket): Promise<ProfileFillerResult> {
    let clientName = `client-${clientId}`
    try {
      const client = await repository.resolveClient(clientId, market)
      clientName = client.clientName
      assertLiveSmokeTarget(client)
      const prepared = await prepareResolved(client)
      return await liveSmoke(prepared)
    } catch (error) {
      return {
        ok: false, dryRun: true, clientId, clientName, market,
        stage: errorStage(error), code: errorCode(error), message: safeErrorMessage(error)
      }
    }
  }

  return { dryRun, liveSmoke, execute, prepare, run, runLiveSmoke, repository }
}

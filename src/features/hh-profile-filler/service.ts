import { activateResume, readResumePublication, verifyActiveResume } from './hh-activation.ts'
import { ensureResumeSkills, verifyResumeSkills } from './hh-skills.ts'
import { ensureEnglishResumeLanguage, verifyEnglishResumeLanguage } from './hh-resume-language.ts'
import { ACTIVE_JOB_SEARCH_STATUS, ensureActiveJobSearchStatus, verifyActiveJobSearchStatus } from './hh-job-search-status.ts'
import { assertCompleteSkills, requiredSkillSet } from './skill-selection.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { operationId, openOperation } from './operation-state.ts'
import { PROFILE_CONTRACT_VERSION, contractIssues, verifyOperationContract } from './contract.ts'
import { createProfileFillerRepository } from './repository.ts'
import { createDriveSourceLoader } from './drive-source.ts'
import { createCvExtractor } from './cv-extractor.ts'
import { buildPreparedProfile } from './profile-builder.ts'
import { errorCode, errorStage, ProfileFillerError, safeErrorMessage } from './errors.ts'
import { withAuthorizedHHPage } from './hh-session.ts'
import { captureArtifactScreenshot, configurePrivacyAndStopList, createResumeDraft, deleteResume,
  completeExistingResume, ensureResumeEnglish, duplicateResumeVariant, INITIAL_HH_PROFESSION, legacyProfessionForTitle,
  inspectHH, listResumes, professionForTitle, resumeDraftFromExperience, resumeDraftFromWorkPermits,
  resumeSkills, verifyKnownDraft, verifyResumeContract, prepareDraftExperience, type ResumeSnapshot } from './hh-resume-ui.ts'
import type { PreparedProfile, ProfileFillerMarket, ProfileFillerResult,
  ProfileFillerScope, ResolvedClient, ResumeContractVerification } from './types.ts'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const { getDolphinProfile } = createRequire(import.meta.url)('../../integrations/dolphin/profiles.ts') as {
  getDolphinProfile(id: number): Promise<{ id: number | string; name?: string }>
}

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
  publication?: { read: typeof readResumePublication; activate: typeof activateResume; verify: typeof verifyActiveResume }
  skills?: { ensure: typeof ensureResumeSkills; verify: typeof verifyResumeSkills }
  resumeLanguage?: { ensure: typeof ensureEnglishResumeLanguage; verify: typeof verifyEnglishResumeLanguage }
  jobSearchStatus?: { ensure: typeof ensureActiveJobSearchStatus; verify: typeof verifyActiveJobSearchStatus }
  loadDolphinProfile?: typeof getDolphinProfile
  repository?: ReturnType<typeof createProfileFillerRepository>
  drive?: ReturnType<typeof createDriveSourceLoader>
  extractor?: ReturnType<typeof createCvExtractor>
  withPage?: typeof withAuthorizedHHPage
  ui?: {
    prepareDraftExperience?: typeof prepareDraftExperience
    completeExistingResume?: typeof completeExistingResume
    ensureResumeEnglish?: typeof ensureResumeEnglish
    configurePrivacyAndStopList: typeof configurePrivacyAndStopList
    createResumeDraft: typeof createResumeDraft
    deleteResume: typeof deleteResume
    duplicateResumeVariant: typeof duplicateResumeVariant
    inspectHH: typeof inspectHH
    listResumes: typeof listResumes
    resumeDraftFromExperience: typeof resumeDraftFromExperience
    resumeDraftFromWorkPermits: typeof resumeDraftFromWorkPermits
    resumeSkills: typeof resumeSkills
    verifyKnownDraft: typeof verifyKnownDraft
    verifyResumeContract: typeof verifyResumeContract
  }
} = {}) {
  const repository = options.repository ?? createProfileFillerRepository()
  const drive = options.drive ?? createDriveSourceLoader()
  let extractor = options.extractor
  const withPage = options.withPage ?? withAuthorizedHHPage
  const ui = options.ui ?? { prepareDraftExperience, configurePrivacyAndStopList, createResumeDraft, deleteResume,
    duplicateResumeVariant, inspectHH, listResumes, resumeDraftFromExperience,
    resumeDraftFromWorkPermits, resumeSkills, verifyKnownDraft, verifyResumeContract,
    completeExistingResume, ensureResumeEnglish }
  const publication = options.publication ?? { read: readResumePublication, activate: activateResume, verify: verifyActiveResume }
  const skills = options.skills ?? { ensure: ensureResumeSkills, verify: verifyResumeSkills }
  const resumeLanguage = options.resumeLanguage ?? { ensure: ensureEnglishResumeLanguage, verify: verifyEnglishResumeLanguage }
  const jobSearchStatus = options.jobSearchStatus ?? { ensure: ensureActiveJobSearchStatus, verify: verifyActiveJobSearchStatus }
  const checkedDryRuns = new WeakSet<PreparedProfile>()

  async function resolveDolphinName(client: ResolvedClient) {
    const detail = await (options.loadDolphinProfile ?? getDolphinProfile)(client.dolphinProfileId)
    if (Number(detail.id) !== client.dolphinProfileId || !detail.name?.trim()) {
      throw new ProfileFillerError('profile_dolphin_name_missing',
        'Dolphin profile name is not verified; filling has not started.', 'resolve_dolphin')
    }
    client.dolphinProfileName = detail.name.trim()
  }

  async function prepareResolved(client: ResolvedClient,
    useNocoIdentity = false): Promise<PreparedProfile> {
    if (useNocoIdentity) throw new ProfileFillerError('profile_identity_override_disabled',
      'An identity override cannot bypass the verified source contract.', 'validate_sources')
    await resolveDolphinName(client)
    const cv = await drive.loadCv(client.cvUrl)
    extractor ??= createCvExtractor()
    const descriptions = await drive.loadExperienceDescriptions(client.studentFolderUrl)
    const extracted = await extractor.extract([cv, ...descriptions], client.market)
    const profile = buildPreparedProfile(client, extracted, new Date().toISOString(), { useNocoIdentity })
    profile.operationId = operationId(profile)
    return profile
  }

  async function prepare(clientId: number, market: ProfileFillerMarket,
    useNocoIdentity = false): Promise<PreparedProfile> {
    const client = await repository.resolveClient(clientId, market)
    try { return await prepareResolved(client, useNocoIdentity) }
    catch (error) {
      throw new ProfileFillerError(errorCode(error), safeErrorMessage(error), errorStage(error), {
        ...(error instanceof ProfileFillerError ? error.details : {}),
        dolphinProfileId: client.dolphinProfileId, dolphinProfileName: client.dolphinProfileName
      })
    }
  }

  async function dryRun(profile: PreparedProfile, jobId?: string, knownDraft = false): Promise<ProfileFillerResult> {
    await repository.revalidateClientStatus(profile.client.clientId, profile.client.market, profile.client)
    const planArtifact = writeJson(
      `prepared-${profile.client.clientId}-${profile.client.market.toLowerCase()}-${Date.now()}.json`,
      sanitizedPlan(profile)
    )
    const inspected = await withPage(profile.client, async (page, artifactDir) => {
      const result = knownDraft ? { resumes: await ui.listResumes(page), artifact: planArtifact } :
        await ui.inspectHH(page, artifactDir)
      return { ...result, artifactDir }
    })
    checkedDryRuns.add(profile)
    return {
      contractVersion: PROFILE_CONTRACT_VERSION, operationId: operationId(profile, jobId),
      dolphinProfileName: profile.client.dolphinProfileName, sourceIdentity: profile.client.sourceIdentity,
      ok: true,
      dryRun: true,
      scope: 'dry-run',
      scopeComplete: true,
      operationComplete: false,
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
    await repository.revalidateClientStatus(profile.client.clientId, profile.client.market, profile.client)
    if (!profile.client.dolphinProfileName) await resolveDolphinName(profile.client)
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
        scope: 'live-smoke',
        contractVersion: PROFILE_CONTRACT_VERSION, operationId: operationId(profile, jobId),
        dolphinProfileName: profile.client.dolphinProfileName, sourceIdentity: profile.client.sourceIdentity,
        scopeComplete: true,
        operationComplete: false,
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
      resumeFrom?: 'experience' | 'skills' | 'work-permits' | 'privacy' | 'delete-old' | 'verify-final' | 'title-variants' | 'activate' } = {}): Promise<ProfileFillerResult> {
    const scope = (executionOptions.resumeFrom ?? 'full') as ProfileFillerScope
    const expectedSkills = requiredSkillSet(profile.cv)
    const scoped = Boolean(executionOptions.resumeFrom)
    if (!scoped && !checkedDryRuns.has(profile)) await dryRun(profile, jobId,
      Boolean(Object.keys(executionOptions.resumeIdsByTitle ?? {}).length))
    checkedDryRuns.delete(profile)
    await repository.revalidateClientStatus(profile.client.clientId, profile.client.market, profile.client)
    if (!profile.client.dolphinProfileName) await resolveDolphinName(profile.client)
    const id = operationId(profile, jobId)
    profile.operationId = id
    const expectedTitles = profile.titles.map(title => professionForTitle(title, profile.client.market))
    if (!expectedTitles.length || new Set(expectedTitles).size !== expectedTitles.length) {
      throw new ProfileFillerError('profile_titles_invalid', 'Expected unique mapped titles.', 'prepare_profile')
    }
    return await withPage(profile.client, async (page, artifactDir) => {
      const initial = await ui.listResumes(page)
      const { state, save } = openOperation(id, initial)
      fs.writeFileSync(path.join(artifactDir, 'old-resumes.json'), JSON.stringify(state.oldResumes, null, 2))
      const targets: ResumeSnapshot[] = []
      const contracts: ResumeContractVerification[] = []
      const created: ResumeSnapshot[] = []
      let baseline: ResumeSnapshot | undefined
      const canDelete = !['experience', 'skills', 'verify-final', 'title-variants', 'activate'].includes(scope) &&
        executionOptions.preserveExisting !== true
      const verify = async (resume: ResumeSnapshot, title: string) => {
        const result = await ui.verifyResumeContract(page, profile, resume, title, artifactDir)
        const issues = contractIssues(result)
        if (issues.length) throw new ProfileFillerError('profile_hh_contract_verification_failed',
          'Required saved resume fields could not be verified.', 'verify', { issues, resumeId: resume.id })
        if (contracts.length && result.contentFingerprint !== contracts[0].contentFingerprint) {
          throw new ProfileFillerError('profile_hh_variant_content_mismatch',
            'Resume variants do not have identical verified content.', 'verify')
        }
        return result
      }
      const verifyCompleted = async (resume: ResumeSnapshot, title: string) => {
        const active = await publication.verify(page, resume)
        if (active.id !== resume.id || active.title !== title || active.isDraft || !active.isActive || !active.searchable) {
          throw new ProfileFillerError('profile_hh_resume_not_active', 'The exact target is not active and searchable.', 'verify_active')
        }
        assertCompleteSkills(await skills.verify(page, active, expectedSkills), expectedSkills)
        if (profile.client.market === 'En') {
          await resumeLanguage.verify(page, active)
          if (active.resumeLanguage !== 'EN') throw new ProfileFillerError('profile_hh_resume_language_incomplete',
            'En resume does not have persisted language EN.', 'verify_resume_language')
        }
        const searchStatus = await jobSearchStatus.verify(page)
        if (searchStatus !== ACTIVE_JOB_SEARCH_STATUS) throw new ProfileFillerError('profile_hh_job_search_status_incomplete',
          'HH job-search status is not active_search.', 'verify_job_search_status')
        return { ...(await verify(active, title)), isDraft: false, isActive: true, searchable: true,
          jobSearchStatus: searchStatus }
      }
      try {
        for (let index = 0; index < profile.titles.length; index += 1) {
          const mapped = profile.titles[index], title = expectedTitles[index]
          const legacy = legacyProfessionForTitle(mapped, profile.client.market)
          const matches = initial.filter(item => item.title.trim() === title || item.title.trim() === legacy)
          if (matches.length > 1) throw new ProfileFillerError('profile_hh_target_ambiguous',
            'Multiple existing resumes match the same mapped title.', 'resolve_resume')
          const knownId = executionOptions.resumeIdsByTitle?.[mapped] ?? state.targets[title]?.id
          let resume = knownId ? initial.find(item => item.id === knownId) : matches[0]
          const recordedSource = state.targets[title]?.id === resume?.id ? state.targets[title]?.nativeSourceId : undefined
          if (resume && recordedSource) resume = { ...resume, nativeSourceId: recordedSource }
          if (knownId && matches[0] && matches[0].id !== knownId) throw new ProfileFillerError(
            'profile_hh_target_ambiguous', 'Known resume ID conflicts with the mapped title.', 'resolve_resume')
          const knownTarget = (targetId: string): ResumeSnapshot => ({ id: targetId, title,
            href: `https://hh.ru/resume/${targetId}`, isDraft: true,
            nativeSourceId: state.targets[title]?.id === targetId ? state.targets[title]?.nativeSourceId : undefined })
          if (scope === 'activate' || scope === 'title-variants') {
            const targetId = knownId ?? resume?.id
            if (scope === 'title-variants' && index > 0 && baseline && targetId && (!resume || resume.isDraft)) {
              // A saved clone ID may precede its title save. Reuse it without another clone POST.
              resume = await ui.duplicateResumeVariant(page, baseline, mapped, profile.client.stack,
                profile.client.market, { artifactDir, duplicateId: targetId })
            } else if (targetId) {
              resume = await publication.read(page, knownTarget(targetId))
            } else if (scope === 'title-variants' && baseline && index > 0) {
              resume = await ui.duplicateResumeVariant(page, baseline, mapped, profile.client.stack,
                profile.client.market, { artifactDir })
              created.push(resume)
            } else throw new ProfileFillerError('profile_hh_recovery_resume_missing',
              'Recovery requires a known baseline or target resume ID.', 'resolve_resume')
          } else if (scope === 'verify-final') {
            if (!knownId) throw new ProfileFillerError('profile_hh_final_resume_id_missing',
              'Final verification requires every known target ID.', 'verify')
            resume = await publication.read(page, knownTarget(knownId))
          } else if (scope === 'privacy' || scope === 'delete-old') {
            if (!resume || resume.title !== title) throw new ProfileFillerError(
              'profile_hh_recovery_draft_missing', 'Recovery requires every exact mapped draft.', 'verify')
            if (scope === 'privacy') {
              // Inspect every earlier section before the first privacy write.
              const before = await ui.verifyResumeContract(page, profile, resume, title, artifactDir)
              const earlier = contractIssues(before).filter(issue =>
                !/privacy|employer|preservation/.test(issue))
              if (earlier.length) throw new ProfileFillerError('profile_hh_recovery_precondition',
                'Content must be complete before privacy recovery.', 'verify', { issues: earlier })
              await ui.configurePrivacyAndStopList(page, resume, profile)
            }
          } else if (scope === 'experience' || scope === 'skills') {
            if (!knownId) throw new ProfileFillerError('profile_hh_recovery_id_missing',
              'Scoped recovery requires every known target ID.', 'verify')
            resume = scope === 'experience'
              ? await ui.resumeDraftFromExperience(page, profile, mapped, knownId, artifactDir,
                  Object.values(executionOptions.resumeIdsByTitle ?? {}))
              : await ui.resumeSkills(page, profile, mapped, knownId, artifactDir)
          } else if (scope === 'work-permits' && index === 0) {
            if (!knownId) throw new ProfileFillerError('profile_hh_recovery_id_missing',
              'Work permit recovery requires its known draft ID.', 'verify')
            const candidate = resume ?? await ui.verifyKnownDraft(page, title, knownId, artifactDir)
            const previous = await ui.verifyResumeContract(page, profile, candidate, title, artifactDir)
            const earlier = contractIssues(previous).filter(issue => !/permits|privacy|employer|preservation/.test(issue))
            if (earlier.length) throw new ProfileFillerError('profile_hh_recovery_precondition',
              'Earlier resume sections must be verified before work permit recovery.', 'verify', { issues: earlier })
            resume = await ui.resumeDraftFromWorkPermits(page, profile, mapped, knownId)
            await ui.configurePrivacyAndStopList(page, resume, profile)
          } else {
            if (resume) {
              // Fully matching existing resumes need no content writes.
              const existing = await ui.verifyResumeContract(page, profile, resume, title, artifactDir)
              if (contractIssues(existing).some(issue => !/privacy|employer|resumeLanguage/.test(issue))) {
                resume = await (ui.completeExistingResume ?? completeExistingResume)(page, profile,
                  mapped, resume, artifactDir)
              }
            } else if (knownId) {
              resume = await ui.createResumeDraft(page, profile, mapped, artifactDir, knownId)
            } else if (index === 0) {
              const unfinished = initial.filter(item => item.isDraft && item.title === INITIAL_HH_PROFESSION)
              if (unfinished.length) throw new ProfileFillerError('profile_hh_recovery_id_required',
                'An unfinished generic draft needs its confirmed --resume-id.', 'resolve_resume')
              resume = await ui.createResumeDraft(page, profile, mapped, artifactDir)
              created.push(resume)
            } else {
              if (!baseline) throw new ProfileFillerError('profile_hh_baseline_unverified',
                'A fully verified baseline is required before duplication.', 'duplicate_resume')
              resume = await ui.duplicateResumeVariant(page, baseline, mapped, profile.client.stack, profile.client.market, { artifactDir })
              state.nativeDuplicateIds.push(resume.id)
              created.push(resume)
              state.targets[title] = resume
              save()
              const copied = await ui.verifyResumeContract(page, profile, resume, title, artifactDir)
              const missingContent = contractIssues(copied).filter(issue =>
                !/privacy|employer|resumeLanguage/.test(issue))
              if (missingContent.length) {
                resume = await (ui.completeExistingResume ?? completeExistingResume)(page, profile,
                  mapped, resume, artifactDir)
              }
            }
            state.targets[title] = resume
            save()
            const existingPublished = state.oldResumes.some(item => item.id === resume!.id && !item.isDraft)
            if (!resume.isDraft && !existingPublished && !state.nativeDuplicateIds.includes(resume.id)) {
              throw new ProfileFillerError('profile_hh_unexpected_publication',
                'An ordinary new resume was unexpectedly published.', 'verify')
            }
            await ui.configurePrivacyAndStopList(page, resume, profile)
          }
          if (!resume) throw new ProfileFillerError('profile_hh_resume_missing', 'Target resume is missing.', 'verify')
          if (targets.some(item => item.id === resume!.id)) throw new ProfileFillerError(
            'profile_hh_duplicate_target_id', 'Different titles resolved to the same resume.', 'verify')
          state.targets[title] = resume
          save()
          const readOnlyContent = ['activate', 'verify-final', 'delete-old'].includes(scope)
          assertCompleteSkills(await (readOnlyContent ? skills.verify : skills.ensure)(page, resume, expectedSkills), expectedSkills)
          if (profile.client.market === 'En') await (readOnlyContent ? resumeLanguage.verify : resumeLanguage.ensure)(page, resume)
          if (!readOnlyContent && resume.isDraft) await ui.prepareDraftExperience?.(page, profile, resume)
          // A full persisted-content check gates publication and every subsequent copy.
          // Read-only final verification performs that same check in verifyCompleted.
          if (scope !== 'verify-final') await verify(resume, title)
          if (scope !== 'verify-final') {
            resume = await publication.activate(page, resume, artifactDir)
            if (resume.id !== state.targets[title].id || resume.title !== title) throw new ProfileFillerError(
              'profile_hh_activation_identity_mismatch', 'Activation changed the target identity.', 'verify_active')
            if (await jobSearchStatus.ensure(page) !== ACTIVE_JOB_SEARCH_STATUS) throw new ProfileFillerError(
              'profile_hh_job_search_status_incomplete', 'HH job-search status was not saved as active_search.', 'verify_job_search_status')
          }
          const verified = await verifyCompleted(resume, title)
          contracts.push(verified)
          targets.push(resume)
          state.targets[title] = resume
          save()
          if (index === 0) baseline = resume
        }
        if (!verifyOperationContract(expectedTitles, contracts, targets.map(item => item.id))) {
          throw new ProfileFillerError('profile_hh_contract_verification_failed',
            'Not every mapped resume satisfies the full contract.', 'verify')
        }
        // A later mutation can change shared HH profile data. Read-only verification
        // already checked each target, and contains no mutations requiring another pass.
        if (scope !== 'verify-final') for (let index = 0; index < targets.length; index += 1) {
          contracts[index] = await verifyCompleted(targets[index], expectedTitles[index])
        }
        await repository.revalidateClientStatus(profile.client.clientId, profile.client.market, profile.client)
        if (canDelete) {
          for (const old of state.oldResumes) {
            if (targets.some(item => item.id === old.id) || state.deletedIds.includes(old.id)) continue
            if (!initial.some(item => item.id === old.id)) continue
            await ui.deleteResume(page, old)
            state.deletedIds.push(old.id)
            save()
          }
        }
        let final = ['verify-final', 'activate', 'title-variants'].includes(scope) ||
          executionOptions.preserveExisting === true ? targets : await ui.listResumes(page)
        // A list redirect is not proof of deletion or absence. Known-ID verification is read-only.
        if (!final.length && targets.every(item => item.isDraft)) {
          final = []
          for (const target of targets) final.push(await ui.verifyKnownDraft(page, target.title, target.id, artifactDir))
          if (canDelete && state.oldResumes.some(old => !targets.some(t => t.id === old.id) &&
              !state.deletedIds.includes(old.id))) throw new ProfileFillerError(
            'profile_hh_final_verification_failed', 'Old-resume deletion could not be verified.', 'verify')
        }
        if (targets.some(target => !final.some(item => item.id === target.id && item.title === target.title &&
            item.isDraft === target.isDraft)) || (canDelete && state.oldResumes.some(old =>
              !targets.some(t => t.id === old.id) && final.some(item => item.id === old.id)))) {
          throw new ProfileFillerError('profile_hh_final_verification_failed',
            'Final resume inventory does not match the verified replacement plan.', 'verify')
        }
        const operationComplete = verifyOperationContract(expectedTitles, contracts, final.map(item => item.id))
        const result: ProfileFillerResult = {
          ok: operationComplete, dryRun: false, scope, scopeComplete: true, operationComplete,
          contractVersion: PROFILE_CONTRACT_VERSION, operationId: id,
          dolphinProfileName: profile.client.dolphinProfileName, sourceIdentity: profile.client.sourceIdentity,
          expectedTitles, finalResumeIds: final.map(item => item.id), activeResumeIds: targets.map(item => item.id),
          jobId, clientId: profile.client.clientId, clientName: profile.client.clientName,
          market: profile.client.market, dolphinProfileId: profile.client.dolphinProfileId,
          stage: scoped ? 'recovery_completed' : 'completed',
          message: operationComplete ? 'Every target resume passed the complete persisted contract.' :
            'The scoped stage passed, but the final resume inventory is not complete.', artifactDir,
          createdResumeTitles: created.map(item => item.title), deletedResumeIds: state.deletedIds,
          privacyVerification: contracts.map(item => item.privacy), contractVerification: contracts
        }
        fs.writeFileSync(path.join(artifactDir, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 })
        return result
      } catch (error) {
        if (state.deletedIds.length) throw new ProfileFillerError('profile_hh_critical_partial_deletion',
          `Replacement verification failed after old-resume deletion: ${safeErrorMessage(error)}`,
          'replace_resumes', { deletedResumeIds: state.deletedIds })
        throw error
      }
    })
  }

  async function run(clientId: number, market: ProfileFillerMarket,
    dryRunOnly = false, jobId?: string, useNocoIdentity = false,
    resumeId?: string,
    resumeFrom?: 'experience' | 'skills' | 'work-permits' | 'privacy' | 'delete-old' | 'verify-final' | 'title-variants' | 'activate',
    orderedResumeIds: string[] = []): Promise<ProfileFillerResult> {
    let clientName = `client-${clientId}`
    let client: ResolvedClient | undefined
    try {
      client = await repository.resolveClient(clientId, market)
      clientName = client.clientName
      const prepared = await prepareResolved(client, useNocoIdentity)
      if (orderedResumeIds.length && (orderedResumeIds.length > prepared.titles.length ||
          (resumeFrom !== 'title-variants' && orderedResumeIds.length !== prepared.titles.length))) {
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
        ok: false, dryRun: dryRunOnly, scope: (resumeFrom ?? (dryRunOnly ? 'dry-run' : 'full')),
        scopeComplete: false, operationComplete: false, jobId, clientId, clientName, market,
        contractVersion: PROFILE_CONTRACT_VERSION,
        operationId: client ? operationId({ client }, jobId) : jobId ?? `failure:${clientId}:${market}`,
        dolphinProfileName: client?.dolphinProfileName, dolphinProfileId: client?.dolphinProfileId,
        sourceIdentity: client?.sourceIdentity,
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
    let client: ResolvedClient | undefined
    try {
      client = await repository.resolveClient(clientId, market)
      clientName = client.clientName
      assertLiveSmokeTarget(client)
      const prepared = await prepareResolved(client)
      return await liveSmoke(prepared)
    } catch (error) {
      return {
        ok: false, dryRun: true, scope: 'live-smoke', scopeComplete: false,
        operationComplete: false, clientId, clientName, market,
        contractVersion: PROFILE_CONTRACT_VERSION, dolphinProfileName: client?.dolphinProfileName,
        dolphinProfileId: client?.dolphinProfileId, sourceIdentity: client?.sourceIdentity,
        stage: errorStage(error), code: errorCode(error), message: safeErrorMessage(error)
      }
    }
  }

  return { dryRun, liveSmoke, execute, prepare, run, runLiveSmoke, repository }
}

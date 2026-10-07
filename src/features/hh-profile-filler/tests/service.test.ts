import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createProfileFillerService as buildService } from '../service.ts'
import { mockPublication, mockSkills, mockResumeLanguage, mockJobSearchStatus } from './publication-fixture.ts'
import { ProfileFillerError } from '../errors.ts'
import type { PreparedProfile } from '../types.ts'

const createProfileFillerService = (options: Parameters<typeof buildService>[0]) =>
  buildService({ repository: {
    async listClients() { throw new Error('Unexpected repository read in service unit test') },
    async resolveClient() { throw new Error('Unexpected repository read in service unit test') },
    async snapshot() { throw new Error('Unexpected repository read in service unit test') }
  }, publication: mockPublication(), skills: mockSkills(), resumeLanguage: mockResumeLanguage(),
    jobSearchStatus: mockJobSearchStatus(), ...options })

export async function runServiceTests() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-profile-filler-test-'))
  const old = [
    { id: 'old-1', title: 'Old 1', href: 'https://hh.ru/resume/old-1', isDraft: false },
    { id: 'old-2', title: 'Old 2', href: 'https://hh.ru/resume/old-2', isDraft: true }
  ]
  const created: any[] = []
  const deleted: string[] = []
  let listCalls = 0
  let createCalls = 0
  const profile: PreparedProfile = {
    client: { clientId: 7, clientName: 'Client', currentStatus: 'on en market', market: 'En',
      stack: 'Java', dolphinProfileId: 123, cvUrl: 'url', cvRevision: '1',
      contacts: { other: [] }, fallbacks: {}, credentials: {} },
    cv: { language: 'en', contacts: { email: 'cv@example.com', other: [] },
      summary: 'Summary', skillGroups: [], skills: Array.from({ length: 30 }, (_, i) => `Skill ${i}`), experience: [{ company: 'Old Co',
        title: 'Engineer', current: true, description: 'Work', technologies: [],
        namedOrganizations: [] }], education: [], languages: [], namedOrganizations: [] },
    titles: ['Title A', 'Title B'], about: 'Contacts\ncv@example.com\n\nSummary\nSummary',
    employerCandidates: [], preparedAt: '2026-09-03T00:00:00Z'
  }
  const fakePage = { screenshot: async () => undefined }
  const service = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { listCalls += 1; return listCalls === 1 ? old : created },
      async createResumeDraft(_page: any, _profile: any, title: string) {
        createCalls += 1
        if (createCalls === 1) throw new ProfileFillerError('profile_hh_resume_limit',
          'limit', 'create_resume')
        const resume = { id: `new-${created.length + 1}`, title,
          href: `https://hh.ru/resume/new-${created.length + 1}`, isDraft: true }
        created.push(resume)
        return resume
      },
      async duplicateResumeVariant(_page: any, source: any, title: string) {
        assert.equal(source.id, 'new-1', 'Use the newly completed draft as baseline')
        const resume = { id: `new-${created.length + 1}`, title,
          href: `https://hh.ru/resume/new-${created.length + 1}`, isDraft: true }
        created.push(resume)
        return resume
      },
      async deleteResume(_page: any, resume: any) { deleted.push(resume.id) },
      async configurePrivacyAndStopList() { return { added: [], existing: [], skipped: [] } },
      async inspectHH() { return { resumes: old, artifact: 'artifact' } }
    } as any
  })
  const result = await service.execute(profile, 'job')
  assert.equal(result.ok, true)
  assert.deepEqual(result.createdResumeTitles, ['Title A', 'Title B'])
  assert.deepEqual(deleted, ['old-1', 'old-2'])
  assert.equal(createCalls, 2, 'Only primary creation and its limit retry use the blank wizard')

  const postPublicationEvents: string[] = []
  const postPublicationService = createProfileFillerService({
    withPage: async (_client: any, action: any) => action(fakePage, artifactDir),
    publication: { ...mockPublication(), activate: async (page, resume) => {
      postPublicationEvents.push(`published:${resume.title}`)
      return mockPublication().activate(page, resume)
    } },
    jobSearchStatus: {
      ensure: async () => { postPublicationEvents.push('ensure-status'); return 'active_search' },
      verify: async () => { postPublicationEvents.push('verify-status'); return 'active_search' }
    },
    ui: { async listResumes() { return created },
      async configurePrivacyAndStopList() { return { added: [], existing: [], skipped: [] } } } as any
  })
  await postPublicationService.execute(profile, undefined, { resumeFrom: 'privacy', preserveExisting: true })
  assert.deepEqual(postPublicationEvents, ['published:Title A', 'ensure-status',
    'published:Title B', 'ensure-status', 'verify-status'])

  let statusWritesDuringVerification = 0
  const missingJobStatus = createProfileFillerService({
    withPage: async (_client: any, action: any) => action(fakePage, artifactDir),
    jobSearchStatus: {
      ensure: async () => { statusWritesDuringVerification += 1; return 'active_search' },
      verify: async () => 'looking_for_offers' as any
    },
    ui: { async listResumes() { return created } } as any
  })
  await assert.rejects(missingJobStatus.execute(profile, undefined, { resumeFrom: 'verify-final',
    resumeIdsByTitle: Object.fromEntries(created.map(resume => [resume.title, resume.id])) }),
    { code: 'profile_hh_job_search_status_incomplete' })
  assert.equal(statusWritesDuringVerification, 0)

  let languageDeletes = 0
  const russianMetadata = createProfileFillerService({
    withPage: async (_client: any, action: any) => action(fakePage, artifactDir),
    publication: { ...mockPublication(), verify: async (page, resume) => ({
      ...await mockPublication().verify(page, resume), resumeLanguage: resume.title === 'Title B' ? 'RU' : 'EN'
    }) },
    ui: { async listResumes() { return [...created, old[0]] },
      async deleteResume() { languageDeletes += 1 } } as any
  })
  await assert.rejects(russianMetadata.execute(profile, undefined, { resumeFrom: 'delete-old' }),
    { code: 'profile_hh_resume_language_incomplete' })
  assert.equal(languageDeletes, 0, 'Every En variant must have persisted EN metadata before cleanup/success')

  let sourceBrowserCalls = 0
  const insufficientSource = createProfileFillerService({
    withPage: async () => { sourceBrowserCalls += 1; throw new Error('Must not open browser') }
  })
  await assert.rejects(insufficientSource.execute({ ...profile, cv: { ...profile.cv, skills: ['Java'] } }),
    { code: 'profile_hh_skills_source_insufficient' })
  assert.equal(sourceBrowserCalls, 0)

  for (const failure of ['empty', '29', 'unset']) {
    let deletes = 0
    let publishes = 0
    const targets = ['Title A', 'Title B'].map((title, i) => ({ id: `skills-${i}`, title,
      href: `https://hh.ru/resume/skills-${i}`, isDraft: false }))
    const readSkills = async (_page: unknown, target: any, expected: string[]) => {
      const saved = expected.map(name => ({ name, level: 'advanced' as string | null }))
      if (target.id === targets[0].id) return saved
      if (failure === 'empty') return []
      if (failure === '29') return saved.slice(0, 29)
      saved[29].level = null
      return saved
    }
    const incompleteCopy = createProfileFillerService({
      withPage: async (_client: any, action: any) => action(fakePage, artifactDir),
      skills: { ensure: readSkills, verify: readSkills },
      publication: { ...mockPublication(), activate: async (...args) => {
        publishes += 1; return mockPublication().activate(args[0], args[1])
      } },
      ui: { async listResumes() { return [...targets, old[0]] },
        async deleteResume() { deletes += 1 } } as any
    })
    await assert.rejects(incompleteCopy.execute(profile, undefined, { resumeFrom: 'delete-old' }),
      { code: 'profile_hh_skills_incomplete' })
    assert.equal(deletes, 0, 'Incomplete copied skills must block old-resume deletion')
    assert.equal(publishes, 0, 'An active baseline must not hide incomplete skills in another title')
  }

  let deletionBeforeActivation = 0
  const inactiveTarget = { id: 'still-draft', title: 'Title A', href: 'https://hh.ru/resume/still-draft',
    isDraft: false }
  const inactive = async (_page: unknown, resume: any) => ({ ...resume, isDraft: true,
    isActive: false, searchable: false, publicationStatus: 'not_finished' })
  const incompleteService = createProfileFillerService({
    repository: {} as any, drive: {} as any, extractor: {} as any,
    withPage: async (_client: any, action: any) => action(fakePage, artifactDir),
    publication: { read: inactive, activate: inactive, verify: inactive },
    ui: {
      async listResumes() { return [inactiveTarget, old[0]] },
      async configurePrivacyAndStopList() { return { added: [], existing: [], skipped: [] } },
      async deleteResume() { deletionBeforeActivation += 1 }
    } as any
  })
  await assert.rejects(incompleteService.execute({ ...profile, titles: ['Title A'] }),
    { code: 'profile_hh_resume_not_active' })
  assert.equal(deletionBeforeActivation, 0, 'Never delete old resumes while a replacement is still a draft')

  const hiddenTitles = ['Title A', 'Title B', 'Title C']
  const hiddenIds: Record<string, string> = { 'Title A': 'known-a', 'Title B': 'known-b' }
  let freshClones = 0
  const recoveryServiceForHiddenList = createProfileFillerService({
    repository: {} as any, drive: {} as any, extractor: {} as any,
    withPage: async (_client: any, action: any) => action(fakePage, artifactDir),
    ui: {
      async listResumes() { return [] },
      async verifyKnownDraft(_page: any, title: string, id: string) {
        assert.equal(id, hiddenIds[title])
        return { id, title, href: `https://hh.ru/resume/${id}`, isDraft: true }
      },
      async duplicateResumeVariant(_page: any, source: any, title: string,
        _stack: string, _market: string, options: any) {
        assert.equal(source.id, 'known-a')
        if (!options.duplicateId) {
          freshClones += 1
          hiddenIds[title] = 'new-c'
        }
        return { id: options.duplicateId ?? hiddenIds[title], title,
          href: `https://hh.ru/resume/${hiddenIds[title]}`, isDraft: true }
      },
      async createResumeDraft() { throw new Error('Do not restart the blank wizard') },
      async configurePrivacyAndStopList() { throw new Error('Title-only recovery preserves privacy') },
      async deleteResume() { throw new Error('Title-only recovery preserves existing resumes') }
    } as any
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const recovered = await recoveryServiceForHiddenList.execute({ ...profile, titles: hiddenTitles },
      undefined, { resumeFrom: 'title-variants', resumeIdsByTitle: { ...hiddenIds } })
    assert.equal(recovered.ok, true)
  }
  assert.equal(freshClones, 1, 'Resume known copies even when the list hides every draft')

  const variantProfile: PreparedProfile = {
    ...profile,
    client: { ...profile.client, market: 'Ru', stack: 'FullStack' },
    titles: [
      'Старший Fullstack разработчик / Senior Fullstack Developer',
      'Старший Backend разработчик / Senior Backend Developer',
      'Старший Frontend разработчик / Senior Frontend Developer'
    ]
  }
  const baseline = { id: 'baseline', title: 'Старший фуллстэк разработчик',
    href: 'https://hh.ru/resume/baseline', isDraft: false }
  const variants = [baseline]
  const duplicateCalls: Array<{ sourceId: string; title: string }> = []
  const configured: string[] = []
  const variantService = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { return variants },
      async duplicateResumeVariant(_page: any, source: any, title: string) {
        duplicateCalls.push({ sourceId: source.id, title })
        const normalized = title.includes('Backend')
          ? 'Старший бэкенд разработчик' : 'Старший фронтенд разработчик'
        const resume = { id: `variant-${variants.length}`, title: normalized,
          href: `https://hh.ru/resume/variant-${variants.length}`, isDraft: true }
        variants.push(resume)
        return resume
      },
      async createResumeDraft() { throw new Error('A filled baseline must be duplicated.') },
      async deleteResume() { throw new Error('Preserved resumes must not be deleted.') },
      async configurePrivacyAndStopList(_page: any, resume: any) {
        configured.push(resume.id)
        return { added: [], existing: [], skipped: [] }
      },
      async inspectHH() { return { resumes: variants, artifact: 'artifact' } }
    } as any
  })
  const variantResult = await variantService.execute(variantProfile, 'variant-job', {
    preserveExisting: true
  })
  assert.equal(variantResult.ok, true)
  assert.deepEqual(duplicateCalls, [
    { sourceId: 'baseline', title: variantProfile.titles[1] },
    { sourceId: 'baseline', title: variantProfile.titles[2] }
  ])
  assert.deepEqual(configured, ['baseline', 'variant-1', 'variant-2'])
  assert.deepEqual(variantResult.createdResumeTitles,
    ['Старший бэкенд разработчик', 'Старший фронтенд разработчик'])

  const recoveryOld = [
    { id: 'ready-first', title: 'Title A', href: 'https://hh.ru/resume/ready-first',
      isDraft: true },
    { id: 'initial-second', title: 'Программист, разработчик',
      href: 'https://hh.ru/resume/initial-second', isDraft: true }
  ]
  const recoveryTargets = [recoveryOld[0]]
  const recoveryStages: string[] = []
  const regularRecoveryCalls: Array<{ title: string; id?: string }> = []
  let recoveryListCalls = 0
  const recoveryService = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() {
        recoveryListCalls += 1
        return recoveryListCalls === 1 ? recoveryOld : recoveryTargets
      },
      async resumeDraftFromWorkPermits(_page: any, _profile: any, title: string, id: string) {
        recoveryStages.push(`${title}:${id}`)
        return recoveryOld[0]
      },
      async createResumeDraft(_page: any, _profile: any, title: string, _dir: string,
        id?: string) {
        regularRecoveryCalls.push({ title, id })
        const resume = { id: id ?? 'new-second', title,
          href: `https://hh.ru/resume/${id ?? 'new-second'}`, isDraft: true }
        recoveryTargets.push(resume)
        return resume
      },
      async deleteResume() { throw new Error('Recovery targets must not be deleted.') },
      async configurePrivacyAndStopList() { return { added: [], existing: [], skipped: [] } },
      async inspectHH() { return { resumes: recoveryOld, artifact: 'artifact' } }
    } as any
  })
  const recoveryResult = await recoveryService.execute(profile, 'recovery-job', {
    resumeIdsByTitle: { 'Title A': 'ready-first' }, resumeFrom: 'work-permits'
  })
  assert.equal(recoveryResult.ok, true)
  assert.deepEqual(recoveryStages, ['Title A:ready-first'])
  assert.deepEqual(regularRecoveryCalls, [
    { title: 'Title B', id: 'initial-second' }
  ])

  const privacyResumes = [
    { id: 'privacy-a', title: 'Title A', href: 'https://hh.ru/resume/privacy-a',
      isDraft: true },
    { id: 'privacy-b', title: 'Title B', href: 'https://hh.ru/resume/privacy-b',
      isDraft: true },
    { id: 'privacy-old', title: 'Old published', href: 'https://hh.ru/resume/privacy-old',
      isDraft: false }
  ]
  const privacyConfigured: string[] = []
  const privacyDeleted: string[] = []
  const privacyService = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { return [...privacyResumes] },
      async createResumeDraft() { throw new Error('Privacy recovery must skip content filling.') },
      async resumeDraftFromWorkPermits() {
        throw new Error('Privacy recovery must skip work permits.')
      },
      async deleteResume(_page: any, resume: any) {
        privacyDeleted.push(resume.id)
        privacyResumes.splice(privacyResumes.findIndex(item => item.id === resume.id), 1)
      },
      async configurePrivacyAndStopList(_page: any, resume: any) {
        privacyConfigured.push(resume.id)
        return { added: [], existing: [], skipped: [] }
      },
      async inspectHH() { return { resumes: privacyResumes, artifact: 'artifact' } }
    } as any
  })
  const privacyResult = await privacyService.execute(profile, 'privacy-job', {
    resumeFrom: 'privacy'
  })
  assert.equal(privacyResult.ok, true)
  assert.deepEqual(privacyConfigured, ['privacy-a', 'privacy-b'])
  assert.deepEqual(privacyDeleted, ['privacy-old'])

  const deleteOnlyResumes = [
    { id: 'delete-a', title: 'Title A', href: 'https://hh.ru/resume/delete-a',
      isDraft: true },
    { id: 'delete-b', title: 'Title B', href: 'https://hh.ru/resume/delete-b',
      isDraft: true },
    { id: 'delete-old', title: 'Old published', href: 'https://hh.ru/resume/delete-old',
      isDraft: false }
  ]
  const deleteOnlyDeleted: string[] = []
  const deleteOnlyService = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { return [...deleteOnlyResumes] },
      async createResumeDraft() { throw new Error('Delete recovery must skip content filling.') },
      async resumeDraftFromWorkPermits() {
        throw new Error('Delete recovery must skip work permits.')
      },
      async configurePrivacyAndStopList() {
        throw new Error('Delete recovery must not mutate privacy again.')
      },
      async deleteResume(_page: any, resume: any) {
        deleteOnlyDeleted.push(resume.id)
        deleteOnlyResumes.splice(deleteOnlyResumes.findIndex(item => item.id === resume.id), 1)
      },
      async inspectHH() { return { resumes: deleteOnlyResumes, artifact: 'artifact' } }
    } as any
  })
  const deleteOnlyResult = await deleteOnlyService.execute(profile, 'delete-job', {
    resumeFrom: 'delete-old'
  })
  assert.equal(deleteOnlyResult.ok, true)
  assert.deepEqual(deleteOnlyDeleted, ['delete-old'])

  const verifiedIds: string[] = []
  const verifyFinalService = createProfileFillerService({
    publication: { ...mockPublication(), verify: async (page, resume) => {
      verifiedIds.push(resume.id)
      return mockPublication().verify(page, resume)
    } },
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { return [] },
      async verifyKnownDraft(_page: any, title: string, id: string) {
        return { id, title, href: `https://hh.ru/resume/${id}`, isDraft: true }
      },
      async createResumeDraft() { throw new Error('Final verification must be read-only.') },
      async resumeDraftFromWorkPermits() { throw new Error('Final verification must be read-only.') },
      async configurePrivacyAndStopList() { throw new Error('Final verification must be read-only.') },
      async deleteResume() { throw new Error('Final verification must not delete anything.') },
      async inspectHH() { return { resumes: [], artifact: 'artifact' } }
    } as any
  })
  const verifyFinalResult = await verifyFinalService.execute(profile, 'verify-final-job', {
    resumeFrom: 'verify-final', resumeIdsByTitle: { 'Title A': 'known-a', 'Title B': 'known-b' }
  })
  assert.equal(verifyFinalResult.ok, true)
  assert.deepEqual(verifiedIds, ['known-a', 'known-b'])

  let destructiveCreateCalls = 0
  const criticalService = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { return old },
      async createResumeDraft() {
        destructiveCreateCalls += 1
        if (destructiveCreateCalls === 1) throw new ProfileFillerError(
          'profile_hh_resume_limit', 'limit', 'create_resume')
        throw new Error('replacement failed')
      },
      async deleteResume() { return undefined },
      async configurePrivacyAndStopList() { return { added: [], existing: [], skipped: [] } },
      async inspectHH() { return { resumes: old, artifact: 'artifact' } }
    } as any
  })
  await assert.rejects(() => criticalService.execute(profile, 'critical-job'),
    (error: any) => error?.code === 'profile_hh_critical_partial_deletion' &&
      Array.isArray(error?.details?.deletedResumeIds))

  const namedFailureService = createProfileFillerService({
    repository: { resolveClient: async () => profile.client } as any,
    drive: { loadCv: async () => { throw new Error('source failed') },
      loadExperienceDescriptions: async () => [] } as any
  })
  const namedFailure = await namedFailureService.run(profile.client.clientId, 'En')
  assert.equal(namedFailure.ok, false)
  assert.equal(namedFailure.clientName, 'Client')

  const previousSmokeClient = process.env.PROFILE_FILLER_SMOKE_CLIENT_ID
  const previousSmokeDolphin = process.env.PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID
  try {
    process.env.PROFILE_FILLER_SMOKE_CLIENT_ID = String(profile.client.clientId)
    process.env.PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID =
      String(profile.client.dolphinProfileId)
    const smokeResumes = [{ id: 'fixture-existing', title: 'Fixture',
      href: 'https://hh.ru/resume/fixture-existing', isDraft: false }]
    const smokeDeleted: string[] = []
    const smokeService = createProfileFillerService({
      repository: {} as any,
      drive: {} as any,
      extractor: {} as any,
      withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
      ui: {
        async listResumes() { return [...smokeResumes] },
        async createResumeDraft(_page: any, _profile: any, title: string) {
          const draft = { id: 'smoke-new', title,
            href: 'https://hh.ru/resume/smoke-new', isDraft: true }
          smokeResumes.push(draft)
          return draft
        },
        async deleteResume(_page: any, resume: any) {
          smokeDeleted.push(resume.id)
          smokeResumes.splice(smokeResumes.findIndex(item => item.id === resume.id), 1)
        }
      } as any
    })
    const smokeResult = await smokeService.liveSmoke(profile)
    assert.equal(smokeResult.stage, 'live_smoke_passed')
    assert.equal(smokeResult.dryRun, true)
    assert.deepEqual(smokeDeleted, ['smoke-new'])
    assert.deepEqual(smokeResumes.map(item => item.id), ['fixture-existing'])

    const failingResumes: any[] = []
    const failureCleanup: string[] = []
    const failingSmokeService = createProfileFillerService({
      repository: {} as any,
      drive: {} as any,
      extractor: {} as any,
      withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
      ui: {
        async listResumes() { return [...failingResumes] },
        async createResumeDraft() {
          failingResumes.push({ id: 'partial-smoke', title: 'Partial',
            href: 'https://hh.ru/resume/partial-smoke', isDraft: true })
          throw new ProfileFillerError('profile_hh_wizard_validation_failed',
            'wizard failed', 'fill_resume')
        },
        async deleteResume(_page: any, resume: any) {
          failureCleanup.push(resume.id)
          failingResumes.splice(failingResumes.findIndex(item => item.id === resume.id), 1)
        }
      } as any
    })
    await assert.rejects(() => failingSmokeService.liveSmoke(profile),
      (error: any) => error?.code === 'profile_hh_wizard_validation_failed')
    assert.deepEqual(failureCleanup, ['partial-smoke'])
    assert.deepEqual(failingResumes, [])

    process.env.PROFILE_FILLER_SMOKE_CLIENT_ID = '999'
    let openedWrongTarget = false
    const guardedSmokeService = createProfileFillerService({
      repository: {} as any,
      drive: {} as any,
      extractor: {} as any,
      withPage: async () => { openedWrongTarget = true; throw new Error('must not open') }
    })
    await assert.rejects(() => guardedSmokeService.liveSmoke(profile),
      (error: any) => error?.code === 'profile_live_smoke_target_mismatch')
    assert.equal(openedWrongTarget, false)
  } finally {
    if (previousSmokeClient === undefined) delete process.env.PROFILE_FILLER_SMOKE_CLIENT_ID
    else process.env.PROFILE_FILLER_SMOKE_CLIENT_ID = previousSmokeClient
    if (previousSmokeDolphin === undefined) delete process.env.PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID
    else process.env.PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID = previousSmokeDolphin
  }
  fs.rmSync(artifactDir, { recursive: true, force: true })
}

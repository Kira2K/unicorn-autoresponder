import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createProfileFillerService } from '../service.ts'
import { ProfileFillerError } from '../errors.ts'
import { makeServiceFixture } from './service-fixture.ts'
import { verifiedContract } from './contract.test.ts'
import { CONTRACT_SECTIONS, assertTerminalSuccess } from '../contract.ts'

export async function runServiceTests() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-profile-filler-test-'))
  const oldStorage = process.env.PROFILE_FILLER_STORAGE_ROOT
  process.env.PROFILE_FILLER_STORAGE_ROOT = path.join(artifactDir, 'state')
  try {
  const fixture = (name: string) => makeServiceFixture(path.join(artifactDir, name))
  const main = fixture('main')
  main.put('Old', 'old', false)
  const result = await main.service.execute(main.profile)
  assert.equal(result.operationComplete, true)
  assert.ok(main.calls.indexOf('verify:r1') < main.calls.indexOf('duplicate:Senior Backend Developer'))
  assert.ok(main.calls.indexOf('privacy:r1') < main.calls.indexOf('duplicate:Senior Backend Developer'))
  assert.ok(main.calls.indexOf('verify:r2') < main.calls.indexOf('delete:old'))
  assert.equal(main.calls.filter(call => call.startsWith('create:')).length, 1)
  assert.equal(result.dolphinProfileName, 'Actual Dolphin EN')
  assert.equal(main.calls.filter(call => call === 'verify:r1').length, 3)
  const shared = fixture('shared-data-changed'); shared.put('Old', 'old')
  shared.controls.corruptBaselineAfterCopy = true
  await assert.rejects(() => shared.service.execute(shared.profile), /Required saved resume fields/)
  assert.ok(!shared.calls.some(call => call.startsWith('delete:')))

  for (const failTitle of main.profile.titles) {
    const f = fixture(`failure-${main.profile.titles.indexOf(failTitle)}`)
    f.put('Old', 'old', false); f.controls.failTitle = failTitle
    await assert.rejects(() => f.service.execute(f.profile), /Required saved resume fields/)
    assert.ok(f.resumes.some(row => row.id === 'old'))
    assert.ok(!f.calls.some(call => call.startsWith('delete:')))
    if (failTitle === f.profile.titles[0]) assert.ok(!f.calls.some(call => call.startsWith('duplicate:')))
  }
  for (const section of CONTRACT_SECTIONS) {
    const unknown = fixture(`unknown-${section}`); unknown.controls.missingCheck = section
    await assert.rejects(() => unknown.service.execute(unknown.profile), /Required saved resume fields/)
    assert.ok(!unknown.calls.some(call => /^(duplicate|delete):/.test(call)), section)
  }
  const limit = fixture('limit'); limit.put('Old', 'old'); limit.controls.limit = true
  await assert.rejects(() => limit.service.execute(limit.profile), /HH limit/)
  assert.deepEqual(limit.resumes.map(row => row.id), ['old'])
  const duplicate = fixture('duplicate'); duplicate.controls.failDuplicate = true
  await assert.rejects(() => duplicate.service.execute(duplicate.profile), /duplicate unavailable/)
  assert.equal(duplicate.calls.filter(call => call.startsWith('create:')).length, 1)
  const published = fixture('publication'); published.controls.malformedPublished = true
  await assert.rejects(() => published.service.execute(published.profile), /unexpectedly published/)
  const ambiguous = fixture('ambiguous')
  ambiguous.put(ambiguous.profile.titles[0], 'a'); ambiguous.put(ambiguous.profile.titles[0], 'b')
  await assert.rejects(() => ambiguous.service.execute(ambiguous.profile), /Multiple existing/)
  assert.ok(!ambiguous.calls.some(call => call.startsWith('create:')))

  for (const scope of ['experience', 'skills', 'privacy', 'delete-old', 'verify-final', 'work-permits', 'activate', 'title-variants'] as const) {
    const f = fixture(scope)
    f.profile.titles.forEach((title, index) => f.put(title, `known-${index}`, scope !== 'verify-final'))
    const resumeIdsByTitle = Object.fromEntries(f.profile.titles.map((title, index) => [title, `known-${index}`]))
    const recovered = await f.service.execute(f.profile, undefined, { resumeFrom: scope, resumeIdsByTitle })
    assert.equal(recovered.operationComplete, true, scope)
    assert.ok(!f.calls.some(call => /^(create|duplicate):/.test(call)), scope)
    if (['experience', 'skills', 'verify-final', 'delete-old'].includes(scope)) {
      assert.ok(!f.calls.some(call => /^privacy:/.test(call)), scope)
    }
  }
  for (const failure of ['inactive', 'wrongLanguage', 'wrongSearchStatus', 'badSkills'] as const) {
    const f = fixture(`completion-${failure}`); f.put('Old', 'old', false); f.controls[failure] = true
    await assert.rejects(() => f.service.execute(f.profile))
    assert.ok(!f.calls.some(call => /^(duplicate|delete):/.test(call)), failure)
    assert.ok(f.resumes.some(row => row.id === 'old'))
  }
  const draftOnly = fixture('read-only-draft')
  draftOnly.profile.titles.forEach((title, i) => draftOnly.put(title, `known-${i}`))
  await assert.rejects(() => draftOnly.service.execute(draftOnly.profile, undefined, {
    resumeFrom: 'verify-final', resumeIdsByTitle: Object.fromEntries(draftOnly.profile.titles.map((title, i) => [title, `known-${i}`]))
  }), /not active/)
  assert.ok(!draftOnly.calls.some(call => /^(activate|create|duplicate|delete|privacy):/.test(call)))
  const variants = fixture('missing-variant')
  variants.put(variants.profile.titles[0], 'baseline', false)
  const copied = await variants.service.execute(variants.profile, undefined, {
    resumeFrom: 'title-variants', resumeIdsByTitle: { [variants.profile.titles[0]]: 'baseline' }
  })
  assert.equal(copied.operationComplete, true)
  assert.ok(!variants.calls.some(call => /^(create|delete|privacy):/.test(call)))
  const partialCopy = fixture('untitled-copy')
  partialCopy.put(partialCopy.profile.titles[0], 'baseline', false)
  partialCopy.put('', 'savedcopy', true)
  const resumedCopy = await partialCopy.service.execute(partialCopy.profile, undefined, {
    resumeFrom: 'title-variants', resumeIdsByTitle: {
      [partialCopy.profile.titles[0]]: 'baseline', [partialCopy.profile.titles[1]]: 'savedcopy'
    }
  })
  assert.equal(resumedCopy.operationComplete, true)
  assert.ok(!partialCopy.calls.some(call => /^(create|duplicate|delete):/.test(call)))
  assert.equal(partialCopy.resumes.length, 2)
  const partial = fixture('partial')
  partial.profile.titles.forEach((title, index) => partial.put(title, `known-${index}`))
  partial.controls.missingCheck = 'skills'
  await assert.rejects(() => partial.service.execute(partial.profile, undefined, {
    resumeFrom: 'experience', resumeIdsByTitle: Object.fromEntries(partial.profile.titles.map((title, i) => [title, `known-${i}`]))
  }), /Required saved resume fields/)
  const inventory = fixture('limited-inventory'); inventory.put('Old', 'old')
  inventory.profile.titles.forEach((title, index) => inventory.put(title, `known-${index}`))
  const incomplete = await inventory.service.execute(inventory.profile, undefined, {
    resumeFrom: 'skills', resumeIdsByTitle: Object.fromEntries(inventory.profile.titles.map((title, i) => [title, `known-${i}`]))
  })
  assert.equal(incomplete.scopeComplete, true)
  assert.equal(incomplete.operationComplete, false)
  assert.throws(() => assertTerminalSuccess(incomplete), /not_terminal/)
  assert.ok(!inventory.calls.some(call => call.startsWith('delete:')))
  const failedPreparation = fixture('preparation'); failedPreparation.controls.sourceFailure = true
  const failed = await failedPreparation.service.run(7, 'En')
  assert.equal(failed.ok, false); assert.equal(failed.dolphinProfileName, 'Actual Dolphin EN')
  assert.ok(!failedPreparation.calls.includes('browser'))
  await assert.rejects(() => failedPreparation.service.prepare(7, 'En'), (error: any) =>
    error.details.dolphinProfileName === 'Actual Dolphin EN')
  const changed = fixture('status'); changed.controls.statusChanged = true
  await assert.rejects(() => changed.service.execute(changed.profile), /Status changed/)
  assert.ok(!changed.calls.includes('browser'))
  const dry = fixture('dry'); const checked = await dry.service.run(7, 'En', true)
  assert.equal(checked.ok, true); assert.equal(checked.operationComplete, false)
  assert.ok(!dry.calls.some(call => /^(create|duplicate|delete|privacy):/.test(call)))
  const override = fixture('override')
  assert.equal((await override.service.run(7, 'En', false, undefined, true)).code, 'profile_identity_override_disabled')

  const profile = main.profile
  const fakePage = { screenshot: async () => undefined }
  const verifiedUi = { async verifyResumeContract(_page: any, _profile: any, resume: any, title: string) {
    return verifiedContract(resume.id, title)
  } }
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
      repository: { async revalidateClientStatus() {} } as any,
      drive: {} as any,
      extractor: {} as any,
      withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
      ui: {
        ...verifiedUi,
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
      repository: { async revalidateClientStatus() {} } as any,
      drive: {} as any,
      extractor: {} as any,
      withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
      ui: {
        ...verifiedUi,
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
  } finally {
    if (oldStorage === undefined) delete process.env.PROFILE_FILLER_STORAGE_ROOT
    else process.env.PROFILE_FILLER_STORAGE_ROOT = oldStorage
    fs.rmSync(artifactDir, { recursive: true, force: true })
  }
}

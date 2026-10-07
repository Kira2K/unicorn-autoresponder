import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureThirtyAdvanced } from '../skill-contract.ts'
import { deliverOnce } from '../report-delivery.ts'
import { acquireProfileLock } from '../profile-lock.ts'
import { verifySourceConfiguration } from '../source-preflight.ts'
import { professionForTitle, legacyProfessionForTitle } from '../hh-resume-ui.ts'
import { STACK_TITLE_MAP } from '../stack-titles.ts'
import { formatProfileFillerReport } from '../report-format.ts'
import { verifiedContract, runContractTests } from './contract.test.ts'
import { experienceContentMatches } from '../content-policy.ts'
import { preserveFirstObservation } from '../preservation-state.ts'
import { normalizedBirthDate } from '../hh-birth-date.ts'
import type { ProfileFillerResult } from '../types.ts'

export async function runStrictInvariantTests() {
  runContractTests()
  assert.equal(normalizedBirthDate('1990-01-02'), '2.1.1990')
  assert.equal(normalizedBirthDate('02.01.1990'), '2.1.1990')
  assert.equal(normalizedBirthDate('unknown'), undefined)
  for (const variants of Object.values(STACK_TITLE_MAP)) {
    for (const title of variants.Ru) assert.equal(professionForTitle(title, 'Ru'), title)
    for (const title of variants.En) assert.equal(professionForTitle(title, 'En'), title)
  }
  assert.equal(legacyProfessionForTitle('Старший Backend разработчик / Senior Backend Developer', 'Ru'), 'Старший бэкенд разработчик')
  const source = { APP_DB: 'postgres', APP_DB_POSTGRES_HOST: 'localhost', APP_DB_POSTGRES_PORT: '5432',
    APP_DB_POSTGRES_DATABASE: 'unicorn_noco_copy', APP_DB_POSTGRES_USER: 'reader', APP_DB_POSTGRES_PASSWORD: 'fake' }
  assert.equal(verifySourceConfiguration(source, source).database, 'unicorn_noco_copy')
  for (const change of [{ APP_DB: '' }, { APP_DB: 'noco' }, { APP_DB_POSTGRES_PORT: '5433' },
    { APP_DB_POSTGRES_DATABASE: 'unicorn_noco_copy_restore' }]) {
    assert.throws(() => verifySourceConfiguration({ ...source, ...change }, source))
  }
  const skills = Array.from({ length: 30 }, (_, i) => `Technology ${i}`)
  let saved = { tags: skills.slice(0, 5), advanced: [] as string[] }, saves = 0
  const operations = {
    same: (a: string, b: string) => a === b,
    async read() { return structuredClone(saved) },
    async saveTags(tags: string[]) { saves++; saved.tags = [...new Set(tags)].slice(0, 30) },
    async saveAdvanced(tags: string[]) { saved.advanced = [...tags] }
  }
  await ensureThirtyAdvanced(operations, skills)
  assert.equal(saved.advanced.length, 30)
  const previousSaves = saves
  await ensureThirtyAdvanced(operations, skills)
  assert.equal(saves, previousSaves, 'matching persisted state must not be saved again')
  saved = { tags: skills.slice(0, 5), advanced: [] }
  await assert.rejects(() => ensureThirtyAdvanced(operations, skills.slice(0, 29)), /Exactly 30/)
  assert.deepEqual(saved.tags, skills.slice(0, 5))
  saved = { tags: [...skills], advanced: [] }
  await assert.rejects(() => ensureThirtyAdvanced({ ...operations,
    async saveAdvanced() { saved.tags = skills.slice(0, 5); saved.advanced = skills.slice(0, 5) }
  }, skills), /tags were restored/)
  assert.deepEqual(saved.tags, skills)
  saved = { tags: [...skills], advanced: [] }
  await assert.rejects(() => ensureThirtyAdvanced({ ...operations,
    async saveAdvanced() { saved.advanced = skills.slice(0, 29) }
  }, skills), /All 30/)

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-invariants-'))
  try {
    assert.deepEqual(preserveFirstObservation('op', 'id', 'test', ['first-hash'], directory), ['first-hash'])
    assert.deepEqual(preserveFirstObservation('op', 'id', 'test', ['later-hash'], directory), ['first-hash'])
    const release = acquireProfileLock(123, path.join(directory, 'locks'))
    assert.throws(() => acquireProfileLock(123, path.join(directory, 'locks')), /locked/)
    release(); acquireProfileLock(123, path.join(directory, 'locks'))()
    let sent = 0
    const send = async () => { sent++ }
    assert.equal(await deliverOnce('operation', 'text', directory, send), 'sent')
    assert.equal(await deliverOnce('operation', 'other artifact', directory, send), 'already_sent')
    assert.equal(sent, 1)
    await assert.rejects(() => deliverOnce('uncertain', 'text', directory, async () => { throw new Error('timeout') }), /timeout/)
    await assert.rejects(() => deliverOnce('uncertain', 'text', directory, send), /delivery_unknown/)
    assert.equal(sent, 1)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  const result: ProfileFillerResult = { ok: true, dryRun: false, scope: 'full', scopeComplete: true,
    operationComplete: true, contractVersion: 2, operationId: 'op', clientId: 1,
    clientName: 'Private Client', dolphinProfileName: 'Actual Dolphin EN', market: 'En', stage: 'completed', message: '',
    expectedTitles: ['Title'], finalResumeIds: ['r1'], contractVerification: [verifiedContract()] }
  assert.equal(formatProfileFillerReport(result), '✅ HH Profile Filler\nПрофиль Dolphin: Actual Dolphin EN\nПолучилось заполнить.')
  const error = formatProfileFillerReport({ ...result, ok: false,
    message: 'Private Client failed; password=secret' })
  assert.match(error, /Профиль Dolphin: Actual Dolphin EN/)
  assert.doesNotMatch(error, /Private Client|password=secret/)
  assert.throws(() => formatProfileFillerReport({ ...result, contractVerification: undefined }), /not_terminal/)
  assert.equal(experienceContentMatches('Company Engineer Jan 2020', { company: 'Company', title: 'Engineer',
    description: 'Required description', current: false, technologies: [], namedOrganizations: [] }), false)
}

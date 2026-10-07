import assert from 'node:assert/strict'
import { applyEmployerCandidatesOneAtATime, EmployerSelectionNotPersistedError,
  mergeEmployerCandidates, parseStopListCompany,
  resolveOfficialEmployerOptions } from '../employer-stop-list.ts'

export async function runEmployerStopListTests() {
  assert.deepEqual(parseStopListCompany(' Amazon, "RBI",, amazon , Yandex '),
    ['Amazon', 'RBI', 'Yandex'])
  assert.deepEqual(parseStopListCompany('Alpha;Beta, Gamma\nDelta'),
    ['Alpha;Beta', 'Gamma\nDelta'])

  assert.deepEqual(mergeEmployerCandidates(
    [{ name: 'AWS', sources: ['noco:stop_list_company'] }],
    [{ name: 'aws', sources: ['cv:experience-context'] },
      { name: 'Employer', sources: ['cv:experience'] }]
  ), [
    { name: 'AWS', sources: ['noco:stop_list_company', 'cv:experience-context'] },
    { name: 'Employer', sources: ['cv:experience'] }
  ])

  assert.deepEqual(resolveOfficialEmployerOptions('AWS', [
    { officialName: 'Amazon Web Services Россия', text: 'Amazon Web Services Россия' },
    { officialName: 'AWS Consult', text: 'AWS Consult' }
  ]).map(item => item.officialName), ['Amazon Web Services Россия'])
  assert.deepEqual(resolveOfficialEmployerOptions('RBI', [
    { officialName: 'Raiffeisen Bank International AG Австрия',
      text: 'Raiffeisen Bank International AG Австрия' }
  ]).map(item => item.officialName), ['Raiffeisen Bank International AG Австрия'])
  assert.deepEqual(resolveOfficialEmployerOptions('Yandex', [
    { officialName: 'Яндекс Москва', text: 'Яндекс Москва' }
  ]).map(item => item.officialName), ['Яндекс Москва'])
  assert.deepEqual(resolveOfficialEmployerOptions('Wildberries', [
    { officialName: 'RWB (Wildberries & Russ)', text: 'RWB (Wildberries & Russ)' }
  ]).map(item => item.officialName), ['RWB (Wildberries & Russ)'])
  assert.deepEqual(resolveOfficialEmployerOptions('Amazon', [
    { officialName: 'Amazon Web Services Россия', text: 'Amazon Web Services Россия' }
  ]), [])
  assert.deepEqual(resolveOfficialEmployerOptions('Employer', [
    { officialName: 'Employer', text: 'Employer' },
    { officialName: 'Employer Group', text: 'Employer Group' }
  ]).map(item => item.officialName), ['Employer'])

  const selected = new Set(['Legacy'])
  const calls: string[] = []
  const outcomes = await applyEmployerCandidatesOneAtATime([
    { name: 'First', sources: ['noco:stop_list_company'] },
    { name: 'Second', sources: ['cv:experience'] }
  ], {
    async inspect(candidate) {
      calls.push(`inspect:${candidate.name}`)
      return { status: selected.has(candidate.name) ? 'selected' : 'unselected',
        officialName: candidate.name }
    },
    async selectAndSave(candidate) {
      calls.push(`save:${candidate.name}`)
      selected.add(candidate.name)
    }
  })
  assert.deepEqual(calls, [
    'inspect:First', 'save:First', 'inspect:First',
    'inspect:Second', 'save:Second', 'inspect:Second'
  ])
  assert.deepEqual([...selected], ['Legacy', 'First', 'Second'])
  assert.deepEqual(outcomes.map(item => item.status), ['added', 'added'])

  let skippedSelectCalls = 0
  const skipped = await applyEmployerCandidatesOneAtATime([
    { name: 'Missing', sources: ['noco:stop_list_company'] },
    { name: 'Ambiguous', sources: ['cv:experience'] }
  ], {
    async inspect(candidate) {
      return { status: 'skipped' as const,
        reason: candidate.name === 'Missing' ? 'not_found' as const : 'ambiguous' as const }
    },
    async selectAndSave() { skippedSelectCalls += 1 }
  })
  assert.equal(skippedSelectCalls, 0)
  assert.deepEqual(skipped.map(item => [item.status, item.reason]), [
    ['skipped', 'not_found'], ['skipped', 'ambiguous']
  ])

  await assert.rejects(() => applyEmployerCandidatesOneAtATime(
    [{ name: 'Lost', sources: ['noco:stop_list_company'] }], {
      async inspect() { return { status: 'unselected', officialName: 'Lost Official' } },
      async selectAndSave() { /* HH discarded the transient selection. */ }
    }), error => error instanceof EmployerSelectionNotPersistedError)
}

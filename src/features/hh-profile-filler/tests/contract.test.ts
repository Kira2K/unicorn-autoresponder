import assert from 'node:assert/strict'
import { CONTRACT_SECTIONS, PROFILE_CONTRACT_VERSION, contractIssues, strictSkillsCheck,
  verifyOperationContract } from '../contract.ts'
import type { ResumeContractVerification } from '../types.ts'

export function verifiedContract(id = 'r1', title = 'Title'): ResumeContractVerification {
  return { resumeId: id, title, isDraft: false, isActive: true, searchable: true, jobSearchStatus: 'active_search', titleVerified: true, experienceVerified: true,
    privacy: { resumeId: id, blacklist: true, hiddenPhones: true, anonymous: true,
      otherFieldsVisible: true, preservedEmployers: true, employers: [] },
    contractVersion: PROFILE_CONTRACT_VERSION, contentFingerprint: 'same-content',
    checks: Object.fromEntries(CONTRACT_SECTIONS.map(name => [name, { status: 'passed' as const }])),
    complete: true, issues: [] }
}

export function runContractTests() {
  const skills = Array.from({ length: 30 }, (_, i) => `Skill ${i}`)
  assert.equal(strictSkillsCheck(skills, skills).status, 'passed')
  for (const [tags, levels] of [[skills.slice(1), skills], [skills, skills.slice(1)],
    [[...skills.slice(1), skills[1]], skills]]) assert.equal(strictSkillsCheck(tags, levels).status, 'failed')
  const valid = verifiedContract()
  for (const invalid of [{ isDraft: true }, { isActive: false }, { searchable: false }, { jobSearchStatus: undefined }]) {
    assert.equal(verifyOperationContract(['Title'], [{ ...valid, ...invalid }], ['r1']), false)
  }
  assert.equal(verifyOperationContract(['Title'], [valid], ['r1']), true)
  for (const name of CONTRACT_SECTIONS) {
    const missing = structuredClone(valid)
    delete missing.checks![name]
    assert.equal(verifyOperationContract(['Title'], [missing], ['r1']), false, name)
    missing.checks![name] = { status: 'failed', reason: 'not persisted' }
    assert.ok(contractIssues(missing).length, name)
  }
  assert.equal(verifyOperationContract(['Title'], [{ ...valid, contractVersion: undefined }], ['r1']), false)
  assert.equal(verifyOperationContract(['Title'], [valid], []), false)
  assert.equal(verifyOperationContract(['Title', 'Other'], [valid, { ...valid, title: 'Other' }], ['r1']), false)
  assert.equal(verifyOperationContract(['Title', 'Other'], [valid,
    { ...verifiedContract('r2', 'Other'), contentFingerprint: 'different' }], ['r1', 'r2']), false)
}

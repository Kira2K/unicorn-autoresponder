import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeServiceFixture } from './service-fixture.ts'

export async function runPreserveExistingTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-preserve-existing-'))
  const previousRoot = process.env.PROFILE_FILLER_STORAGE_ROOT
  process.env.PROFILE_FILLER_STORAGE_ROOT = root
  try {
    const fixture = makeServiceFixture(root)
    fixture.put('Existing unrelated resume', 'old', false)
    const result = await fixture.service.execute(fixture.profile, undefined, { preserveExisting: true })
    assert.equal(result.operationComplete, true)
    assert.equal(fixture.calls.some(call => call.startsWith('delete:')), false)
    assert.equal(fixture.resumes.some(resume => resume.id === 'old'), true)
    assert.equal(result.finalResumeIds?.includes('old'), false, 'completion accounts for the managed target set')
  } finally {
    if (previousRoot === undefined) delete process.env.PROFILE_FILLER_STORAGE_ROOT
    else process.env.PROFILE_FILLER_STORAGE_ROOT = previousRoot
    fs.rmSync(root, { recursive: true, force: true })
  }
}

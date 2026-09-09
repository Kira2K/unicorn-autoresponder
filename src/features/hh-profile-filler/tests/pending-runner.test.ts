import assert from 'node:assert/strict'
import { shouldReportProfileFillerStatus } from '../pending-runner.ts'

export function runPendingRunnerTests() {
  assert.equal(shouldReportProfileFillerStatus('pending'), false)
  assert.equal(shouldReportProfileFillerStatus('dry_run_passed'), false)
  assert.equal(shouldReportProfileFillerStatus('failed'), false)
  assert.equal(shouldReportProfileFillerStatus('completed'), true)
  assert.equal(shouldReportProfileFillerStatus('exhausted'), true)
  assert.equal(shouldReportProfileFillerStatus('cancelled'), true)
}

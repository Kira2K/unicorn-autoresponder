import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testDir, '../../../..')

export function runProcessIsolationTests() {
  const autoresponses = fs.readFileSync(
    path.join(repoRoot, 'scripts/run-hh-autoresponses-daily.ps1'), 'utf8')
  const profileFiller = fs.readFileSync(
    path.join(repoRoot, 'scripts/run-hh-profile-filler-daily.ps1'), 'utf8')
  const registration = fs.readFileSync(
    path.join(repoRoot, 'scripts/register-hh-profile-filler-task.ps1'), 'utf8')

  assert.doesNotMatch(autoresponses, /profile-filler|Profile Filler/i)
  assert.doesNotMatch(profileFiller, /npm run orchestrator|ORCHESTRATOR_WORK_WITH_MARKET/i)
  assert.match(registration, /HH-Autoresponses-Daily/)
  assert.match(registration, /HH-Profile-Filler-Daily/)
  assert.match(registration, /Unregister-ScheduledTask[^\r\n]+LegacyTaskName/)
}

import assert from 'node:assert/strict'
import { connectionAudienceLabel, connectionCountdown, connectionProgressPercent,
  connectionPollDelay, connectionQuotaLabel, connectionRunActive,
  connectionPauseFromError, connectionRunCanStart, connectionRunConfirmation, connectionRunLabel,
  connectionStopConfirmation,
  latestConnectionRun } from './connection-inviter-view.js'

const run = { platformAccountId: 2, status: 'succeeded', connectionCount: 320,
  dailyLimit: 11, dailyQuota: 11, audienceQuota: { recruiter: 8, technical: 3 } }
assert.equal(latestConnectionRun([{ platformAccountId: 1 }, run], 2), run)
assert.equal(connectionRunActive({ status: 'running' }), true)
assert.equal(connectionRunActive(run), false)
assert.equal(connectionPollDelay(false), 5_000)
assert.equal(connectionPollDelay(true), 15_000)
assert.equal(connectionRunLabel(run), 'Completed')
assert.equal(connectionRunLabel({ ...run, stage: 'completed_shortfall' }), 'Target not reached')
assert.equal(connectionRunLabel(null), 'Not run today')
assert.equal(connectionQuotaLabel(run), '320 connections · 11/day · 11 today')
assert.equal(connectionAudienceLabel(run), '8 recruiters · 3 technical')
assert.equal(connectionProgressPercent(4, 11), 36)
assert.equal(connectionCountdown(90_000), '00:01:30')
assert.equal(connectionRunLabel({ ...run, status: 'running', stage: 'waiting_retry' }),
  'Waiting — automatic retry')
assert.equal(connectionRunLabel({ ...run, status: 'partial', stage: 'search_exhausted' }),
  'Catalog exhausted')
assert.match(connectionRunConfirmation({ clientName: 'Student' }, run),
  /LIVE LinkedIn action: send up to 11 real invitations/)
assert.match(connectionRunConfirmation({ clientName: 'Student' }, null, true),
  /calculated daily quota.*recruiters only/)
assert.equal(connectionRunLabel({ status: 'stopped' }), 'Stopped')
const today = '2026-08-29'
assert.equal(connectionRunCanStart({ ...run, localDate: today,
  counters: { sent: 2 } }, true, today), true)
assert.equal(connectionRunCanStart({ ...run, localDate: today,
  counters: { sent: 11 } }, true, today), false)
assert.equal(connectionRunCanStart({ ...run, localDate: '2026-08-28',
  counters: { sent: 11 } }, true, today), true)
assert.equal(connectionRunCanStart({ ...run, status: 'running', localDate: today }, true, today), false)
assert.deepEqual(connectionPauseFromError({ status: 429, body: { error: 'noco_rate_limited' } }), {
  code: 'noco_rate_limited', message: 'NocoDB is temporarily busy. Run today to resume.' })
assert.equal(connectionPauseFromError({ status: 400 }), null)
assert.match(connectionStopConfirmation({ clientName: 'Student' }), /No new invitation will start/)
console.log('connection inviter view tests passed')

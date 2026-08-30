import assert from 'node:assert/strict'
import { connectionAudienceLabel, connectionCountdown, connectionFilterDiagnostics,
  connectionFunnelLabel, connectionProgressPercent, connectionPollDelay, connectionQuotaLabel,
  connectionRunActive, connectionPauseFromError, connectionRunCanStart, connectionRunConfirmation,
  connectionRunLabel, connectionStopConfirmation, latestConnectionRun } from './connection-inviter-view.js'

const run = { platformAccountId: 2, status: 'succeeded', connectionCount: 320,
  dailyLimit: 11, dailyQuota: 11, audienceQuota: { recruiter: 8, technical: 3 },
  skipReasonCounters: { 'hard:role_mismatch': 7, 'soft:city_outside_target': 12,
    'intersection:role_mismatch+city_outside_target': 5,
    'audience:recruiter:hard:role_mismatch': 7 },
  counters: { filterFunnel: { recruiter: { found: 20, structurallyValid: 19, roleMatched: 12,
    historyClear: 10, preflightPassed: 8, claimed: 8, sent: 7 } } } }
assert.equal(latestConnectionRun([{ platformAccountId: 1 }, run], 2), run)
assert.equal(connectionRunActive({ status: 'running' }), true)
assert.equal(connectionRunActive(run), false)
assert.equal(connectionPollDelay(false), 5_000)
assert.equal(connectionPollDelay(true), 15_000)
assert.equal(connectionRunLabel(run), 'Completed')
assert.equal(connectionRunLabel({ ...run, stage: 'completed_shortfall' }), 'Target not reached')
assert.equal(connectionRunLabel(null), 'Not run today')
assert.equal(connectionQuotaLabel(run), '320 connections / 11/day / 11 today')
assert.equal(connectionAudienceLabel(run), '8 recruiters / 3 technical')
assert.deepEqual(connectionFilterDiagnostics(run, 'hard'), [['role_mismatch', 7]])
assert.deepEqual(connectionFilterDiagnostics(run, 'soft'), [['city_outside_target', 12]])
assert.deepEqual(connectionFilterDiagnostics(run, 'intersection'),
  [['role_mismatch+city_outside_target', 5]])
assert.equal(connectionFunnelLabel(run, 'recruiter'),
  'recruiter: 20 found / 19 valid / 12 role / 10 history / 8 preflight / 8 claimed / 7 sent')
assert.equal(connectionProgressPercent(4, 11), 36)
assert.equal(connectionCountdown(90_000), '00:01:30')
assert.equal(connectionRunLabel({ ...run, status: 'running', stage: 'waiting_retry' }),
  'Waiting - automatic retry')
assert.equal(connectionRunLabel({ ...run, status: 'partial', stage: 'search_exhausted' }),
  'Catalog exhausted')
assert.equal(connectionRunLabel({ ...run, status: 'partial', stage: 'daily_window_closed' }),
  'Partial - day closed')
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
assert.equal(connectionRunActive({ status: 'running', localDate: '2026-08-28' }, today), false)
assert.equal(connectionRunCanStart({ ...run, status: 'running', localDate: today }, true, today), false)
assert.deepEqual(connectionPauseFromError({ status: 429, body: { error: 'noco_rate_limited' } }), {
  code: 'noco_rate_limited', message: 'NocoDB is temporarily busy. Run today to resume.' })
assert.equal(connectionPauseFromError({ status: 400 }), null)
assert.match(connectionStopConfirmation({ clientName: 'Student' }), /No new invitation will start/)
console.log('connection inviter view tests passed')

import assert from 'node:assert/strict'
import { connectionAudienceLabel, connectionPollDelay, connectionQuotaLabel, connectionRunActive,
  connectionRunConfirmation, connectionRunLabel, connectionStopConfirmation,
  latestConnectionRun } from './connection-inviter-view.js'

const run = { platformAccountId: 2, status: 'succeeded', connectionCount: 320,
  dailyLimit: 11, dailyQuota: 11, audienceQuota: { recruiter: 8, technical: 3 } }
assert.equal(latestConnectionRun([{ platformAccountId: 1 }, run], 2), run)
assert.equal(connectionRunActive({ status: 'running' }), true)
assert.equal(connectionRunActive(run), false)
assert.equal(connectionPollDelay(false), 5_000)
assert.equal(connectionPollDelay(true), 15_000)
assert.equal(connectionRunLabel(run), 'Completed')
assert.equal(connectionRunLabel(null), 'Not run today')
assert.equal(connectionQuotaLabel(run), '320 connections · 11/day · 11 today')
assert.equal(connectionAudienceLabel(run), '8 recruiters · 3 technical')
assert.match(connectionRunConfirmation({ clientName: 'Student' }, run),
  /LIVE LinkedIn action: send up to 11 real invitations/)
assert.match(connectionRunConfirmation({ clientName: 'Student' }, null, true),
  /calculated daily quota.*recruiters only/)
assert.equal(connectionRunLabel({ status: 'stopped' }), 'Stopped')
assert.match(connectionStopConfirmation({ clientName: 'Student' }), /No new invitation will start/)
console.log('connection inviter view tests passed')

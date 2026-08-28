import assert from 'node:assert/strict'
import { connectionAudienceLabel, connectionQuotaLabel, connectionRunActive,
  connectionRunLabel, latestConnectionRun } from './connection-inviter-view.js'

const run = { platformAccountId: 2, status: 'succeeded', connectionCount: 320,
  dailyLimit: 11, dailyQuota: 11, audienceQuota: { recruiter: 8, technical: 3 } }
assert.equal(latestConnectionRun([{ platformAccountId: 1 }, run], 2), run)
assert.equal(connectionRunActive({ status: 'running' }), true)
assert.equal(connectionRunActive(run), false)
assert.equal(connectionRunLabel(run), 'Completed')
assert.equal(connectionRunLabel(null), 'Not run today')
assert.equal(connectionQuotaLabel(run), '320 connections · 11/day · 11 today')
assert.equal(connectionAudienceLabel(run), '8 recruiters · 3 technical')
console.log('connection inviter view tests passed')

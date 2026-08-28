import assert from 'node:assert/strict'
import { connectionAudienceLabel, connectionQuotaLabel, connectionRunActive,
  connectionRunLabel, latestConnectionRun } from './connection-inviter-view.js'

const run = { platformAccountId: 2, status: 'succeeded', connectionCount: 320,
  weeklyLimit: 11, dailyQuota: 3, audienceQuota: { recruiter: 2, technical: 1 } }
assert.equal(latestConnectionRun([{ platformAccountId: 1 }, run], 2), run)
assert.equal(connectionRunActive({ status: 'running' }), true)
assert.equal(connectionRunActive(run), false)
assert.equal(connectionRunLabel(run), 'Completed')
assert.equal(connectionRunLabel(null), 'Not run today')
assert.equal(connectionQuotaLabel(run), '320 connections · 11/week · 3 today')
assert.equal(connectionAudienceLabel(run), '2 recruiters · 1 technical')
console.log('connection inviter view tests passed')

const assert = require('node:assert/strict')
const {
  failedRunAction, historyForAccounts, primaryAction, statusView
} = require('./linkedin-auth-view.js')

const disconnected = { platformAccountId: 1 }
const existing = { platformAccountId: 2, unipileAccountId: 'acc_2' }

assert.deepEqual(primaryAction(disconnected), { action: 'connect', label: 'Connect' })
assert.deepEqual(failedRunAction({ status: 'failed', errorCode: 'linkedin_url_invalid' }, disconnected),
  { action: 'edit_url', label: 'Fix URL' })
assert.deepEqual(failedRunAction({ status: 'failed' }, disconnected),
  { action: 'connect', label: 'Retry connect' })
assert.deepEqual(failedRunAction({ status: 'failed' }, existing),
  { action: 'force_reauth', label: 'Reconnect' })
assert.equal(failedRunAction({ status: 'succeeded' }, existing), null)
assert.deepEqual(historyForAccounts([
  { runId: 'one', platformAccountId: 1 }, { runId: 'two', platformAccountId: 2 }
], [existing]), [{ runId: 'two', platformAccountId: 2 }])
assert.equal(statusView({}, {
  status: 'running', stage: 'unipile_authentication'
}).stage, 'Connecting to Unipile')

console.log('linkedin auth view tests passed')

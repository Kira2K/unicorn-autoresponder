import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { serveTestApp } from './postgres/workflow-http.mts'
import { linkedInBrowserFailure } from './linkedin-browser-failure.mts'
const require = createRequire(import.meta.url)
const express = require('express')
const { registerProfileFillerRoutes } = require('./profile-filler-routes.ts')
const { registerCommentMonitorRoutes } = require('./comment-monitor-routes.ts')
const { registerConnectionInviterRoutes } = require('./connection-inviter-routes.ts')
const { registerPostWriterRoutes } = require('./post-writer-routes.ts')

test('browser error mapping leaves other failures unchanged', () => {
  for (const error of [undefined, null, 'failure', Error('failure'), { code: 'noco_rate_limited' },
    { code: 'profile_state_persist_failed' }]) assert.equal(linkedInBrowserFailure(error), undefined)
})

test('all LinkedIn routes report browser refusal as a safe, explicit conflict', async () => {
  const fail = async () => { throw Object.assign(Error('Private provider credentials'), { code: 'linkedin_browser_unsupported' }) }
  const app = express(); app.use(express.json())
  const admin = (_req: unknown, _res: unknown, next: () => void) => next()
  registerProfileFillerRoutes({ app, requireAdmin: admin, service: {
    startPreview: fail, startGeneration: fail, searchParameters: fail } })
  registerCommentMonitorRoutes({ app, requireAdmin: admin, service: { enable: fail } })
  registerConnectionInviterRoutes({ app, requireAdmin: admin, service: { start: fail, withdrawals: { preview: fail } } })
  registerPostWriterRoutes(app, admin, { start: fail })
  const server = await serveTestApp(app)
  try {
    for (const [path, method, body] of [
      ['profile-parameters?type=SKILL&keywords=Python', 'GET'], ['profile-previews', 'POST', {}],
      ['profile-generations', 'POST'], ['comment-monitor', 'PUT', { enabled: true }],
      ['connection-runs', 'POST', {}], ['invitation-withdrawal/preview', 'GET'],
      ['post-writer/runs', 'POST', { mode: 'automatic' }]
    ] as const) {
      const response = await fetch(server.base + '/api/admin/linkedin/accounts/7/' + path, { method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
      const result = await response.json()
      assert.equal(response.status, 409, path + ': ' + JSON.stringify(result))
      assert.equal(result.error, 'linkedin_browser_unsupported')
      assert.match(result.message, /Dolphin/)
      assert.doesNotMatch(result.message, /Private|credentials/)
    }
  } finally { await server.close() }
})

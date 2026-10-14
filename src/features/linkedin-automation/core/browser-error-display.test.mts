import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { linkedinBrowserErrorDisplay, linkedinBrowserErrorText } from './browser-error-display.mts'
import { linkedInBrowserFailure } from '../../web-console/backend/linkedin-browser-failure.mts'
const require = createRequire(import.meta.url)
const { generationErrorText, profileRequestError } = require('../../web-console/frontend/src/profile-generation-view.js') as {
  generationErrorText(code: string): string | undefined
  profileRequestError(error: { body: { error: string } }, fallback?: string): string
}
const { monitorError } = require('../../web-console/frontend/src/comment-monitor-view.js') as {
  monitorError(code: string): string
}
const { connectionErrorText } = require('../../web-console/frontend/src/connection-inviter-view.js') as {
  connectionErrorText(code: string): string
}
const { postErrorText } = require('../../web-console/frontend/src/post-writer-view.js') as {
  postErrorText(code: string): string
}
const { authErrorText, statusView } = require('../../web-console/frontend/src/linkedin-auth-view.js') as {
  authErrorText(code: string): string | undefined
  statusView(account: unknown, run: unknown): unknown
}
const { linkedinAuthErrorDisplay } = require('../account-connection/error-display.ts')

test('LinkedIn browser errors explain the reason and next step in API, saved jobs and history', () => {
  for (const code of ['linkedin_browser_unsupported', 'dolphin_en_profile_not_found', 'dolphin_en_profile_ambiguous']) {
    const display = linkedinBrowserErrorDisplay(code)!
    const text = linkedinBrowserErrorText(code)!
    assert.equal(display.code, code)
    assert.match(display.message, /Dolphin/)
    assert.match(display.message, /Unipile/)
    assert.match(display.action, /ученик/)
    assert.equal(generationErrorText(code), text)
    assert.equal(profileRequestError({ body: { error: code } }), text)
    assert.equal(connectionErrorText(code), text)
    assert.equal(postErrorText(code), text)
    assert.equal(monitorError(code), `${text} (${code})`)
    assert.equal(authErrorText(code), text)
    assert.deepEqual(linkedinAuthErrorDisplay(code), display)
    assert.deepEqual(statusView({}, { status: 'failed', errorCode: code }), {
      tone: 'warning', label: 'Браузер', error: display
    })
  }
  assert.match(linkedinBrowserErrorText('linkedin_browser_unsupported')!, /Octo.*не подключаются/)
  assert.match(linkedinBrowserErrorText('dolphin_en_profile_not_found')!, /не найден.*Octo/)
  assert.match(linkedinBrowserErrorText('dolphin_en_profile_ambiguous')!, /несколько.*один/)
  const mapped = linkedInBrowserFailure(Object.assign(Error('private raw error'), { code: 'linkedin_browser_unsupported' }))!
  assert.equal(mapped.status, 409)
  assert.equal(mapped.body.message, linkedinBrowserErrorText(mapped.body.error))
  assert.doesNotMatch(mapped.body.message, /private/)
})

test('Unrelated errors keep their existing text and behavior', () => {
  for (const code of ['', 'unknown', 'unipile_timeout', 'noco_rate_limited', 'constructor']) {
    assert.equal(linkedinBrowserErrorText(code), undefined)
    assert.equal(linkedinBrowserErrorDisplay(code), undefined)
    assert.equal(authErrorText(code), undefined)
    assert.equal(connectionErrorText(code), code)
    assert.equal(postErrorText(code), code)
  }
  assert.equal(generationErrorText('unknown'), undefined)
  assert.equal(profileRequestError({ body: { error: 'unknown' } }, 'fallback'), 'fallback')
  assert.equal(monitorError('unknown'), 'Comment monitoring stopped. (unknown)')
  assert.deepEqual(statusView({}, { status: 'failed' }), { tone: 'danger', label: 'Error', error: undefined })
  assert.match(linkedinAuthErrorDisplay('unipile_timeout').message, /did not respond/)
})

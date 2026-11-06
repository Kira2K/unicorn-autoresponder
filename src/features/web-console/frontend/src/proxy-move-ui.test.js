import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasProxyMoveProfile } from './proxy-move-ui.js'
test('move requires a provisioned EN profile with attached proxy; access does not remove availability', () => {
  const en = { id: 433, locale: 'en', phase: 'ready', proxy: { configured: true, isMadeByExpert: true } }
  for (const phase of ['ready', 'preparing', 'granted', 'awaiting_close']) assert.equal(hasProxyMoveProfile({ profiles: [{ ...en, phase }] }), true)
  for (const profile of [{ ...en, locale: 'ru' }, { ...en, phase: 'queued' }, { ...en, phase: 'deleting' }, { ...en, proxy: { configured: false } }, { ...en, proxy: undefined }])
    assert.equal(hasProxyMoveProfile({ profiles: [profile] }), false)
  assert.equal(hasProxyMoveProfile({ profiles: [] }), false)
  assert.equal(hasProxyMoveProfile(null), false)
})

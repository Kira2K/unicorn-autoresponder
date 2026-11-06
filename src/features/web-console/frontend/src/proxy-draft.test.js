import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proxyDraftChanged } from './proxy-draft.js'
test('only changed connection fields make a saved draft dirty; reverting restores it', () => {
  const saved = { type: 'socks5', host: 'example.invalid', port: 1080, login: 'a', password: 'b' }
  assert.equal(proxyDraftChanged({ ...saved, phase: 'granted', title: 'temporary' }, saved), false)
  for (const key of ['host', 'login', 'password']) assert.equal(proxyDraftChanged({ ...saved, [key]: 'changed' }, saved), true)
  assert.equal(proxyDraftChanged({ ...saved, port: '1080' }, saved), false)
  assert.equal(proxyDraftChanged({ ...saved, host:'EXAMPLE.INVALID' },saved),false)
  assert.equal(proxyDraftChanged({ ...saved }, saved), false)
})

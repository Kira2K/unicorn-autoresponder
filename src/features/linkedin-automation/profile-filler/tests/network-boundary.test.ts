const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('service and fake adapter do not import Unipile client or call fetch', () => {
  for (const relative of ['../service.ts', './fake-profile-client.ts']) {
    const source = fs.readFileSync(path.resolve(__dirname, relative), 'utf8')
    assert.equal(source.includes('integrations/unipile'), false, `${relative} imports live integration`)
    assert.equal(/\bfetch\s*\(/.test(source), false, `${relative} contains a network call`)
  }
})

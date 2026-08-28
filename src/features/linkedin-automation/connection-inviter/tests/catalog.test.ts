const assert = require('node:assert/strict')
const { CONNECTION_SEARCH_CATALOG, renderSearchKeywords } = require('../catalog.ts') as
  typeof import('../catalog.ts')

assert.equal(CONNECTION_SEARCH_CATALOG.length, 400)
assert.equal(new Set(CONNECTION_SEARCH_CATALOG.map(item => item.sourceKey)).size, 400)
assert.equal(CONNECTION_SEARCH_CATALOG.every(item => item.enabled && item.city &&
  item.keywordTemplate.includes('{stack}')), true)
assert.equal(CONNECTION_SEARCH_CATALOG.some(item => item.city === 'Barcelona'), true)
assert.equal(CONNECTION_SEARCH_CATALOG.some(item => item.city === 'Beijing'), true)
assert.deepEqual(new Set(CONNECTION_SEARCH_CATALOG.map(item => item.audience)),
  new Set(['recruiter', 'technical']))
const template = CONNECTION_SEARCH_CATALOG.find(item => item.city === 'Barcelona' &&
  item.audience === 'recruiter')!
assert.match(renderSearchKeywords(template, 'Python'), /Python Barcelona$/)
assert.match(renderSearchKeywords(template, undefined, true), /IT Barcelona$/)
console.log('connection search catalog tests passed')

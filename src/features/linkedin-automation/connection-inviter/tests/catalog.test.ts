const assert = require('node:assert/strict')
const { CONNECTION_SEARCH_CATALOG, renderSearchKeywords } = require('../catalog.ts') as
  typeof import('../catalog.ts')

assert.equal(CONNECTION_SEARCH_CATALOG.length, 400)
assert.equal(new Set(CONNECTION_SEARCH_CATALOG.map(item => item.sourceKey)).size, 400)
assert.equal(CONNECTION_SEARCH_CATALOG.every(item => item.enabled && item.city), true)
assert.equal(CONNECTION_SEARCH_CATALOG.filter(item => item.audience === 'recruiter')
  .every(item => !item.keywordTemplate.includes('{stack}')), true)
assert.equal(CONNECTION_SEARCH_CATALOG.filter(item => item.audience === 'technical')
  .every(item => item.keywordTemplate.includes('{stack}')), true)
assert.equal(CONNECTION_SEARCH_CATALOG.some(item => item.city === 'Barcelona'), true)
assert.equal(CONNECTION_SEARCH_CATALOG.some(item => item.city === 'Beijing'), true)
assert.deepEqual(new Set(CONNECTION_SEARCH_CATALOG.map(item => item.audience)),
  new Set(['recruiter', 'technical']))
const template = CONNECTION_SEARCH_CATALOG.find(item => item.city === 'Barcelona' &&
  item.audience === 'recruiter')!
assert.equal(renderSearchKeywords(template, 'Python').includes('Python'), false)
assert.match(renderSearchKeywords(template, 'Python'), /Barcelona$/)
const legacy = { ...template, keywordTemplate: 'Technical Recruiter {stack} Barcelona' }
assert.equal(renderSearchKeywords(legacy, 'GO'), 'Technical Recruiter Barcelona')
assert.equal(renderSearchKeywords(legacy, undefined, true), 'Technical Recruiter Barcelona')
console.log('connection search catalog tests passed')

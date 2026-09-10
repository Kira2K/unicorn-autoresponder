import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('Writer dependency graph contains only content logic and contracts', () => {
  const root = join(process.cwd(), 'src/features/linkedin-automation/post-writer')
  const allowed = new Set(['writer.ts', 'writer-types.ts', 'content-validation.ts',
    'content-identity.ts', 'novelty.ts', 'errors.ts', 'reserve-repair.ts', 'content-rules.ts', 'writer-topic.ts',
    'post-length.ts'])
  const visited = new Set<string>()
  function inspect(name: string) {
    assert.ok(allowed.has(name), `Unexpected Writer dependency: ${name}`)
    if (visited.has(name)) return
    visited.add(name)
    const source = readFileSync(join(root, name), 'utf8')
    assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|\brequire\s*\(|\bimport\s*\(/)
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (match[1] === 'node:crypto') continue
      assert.ok(match[1].startsWith('./'), `Unexpected external dependency: ${match[1]}`)
      inspect(match[1].slice(2))
    }
  }
  inspect('writer.ts')
  assert.equal(visited.size, allowed.size)
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../../..')
const FEATURE_ROOT = path.resolve(__dirname)

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

function assertNoRawIntegrationImports(): void {
  const forbidden = [
    /require\(['"](?:\.\.\/)+db\//,
    /require\(['"](?:\.\.\/)+dolphin\//,
    /require\(['"](?:\.\.\/)+messenger\.ts['"]/,
    /require\(['"](?:\.\.\/)+noco\//,
    /require\(['"](?:\.\.\/)+sheets\//,
    /require\(['"](?:\.\.\/)+google-sheets-check\.ts['"]/
  ]

  for (const file of walk(FEATURE_ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const pattern of forbidden) {
      assert.equal(
        pattern.test(source),
        false,
        `${path.relative(ROOT, file)} imports a raw integration path`
      )
    }
  }
}

function assertArchitectureDocsAreCurrent(): void {
  const docs = [
    'docs/ARCHITECTURE.md',
    'docs/DEBUGGING.md'
  ]
  const forbidden = [
    /node\s+(?:orchestrator|doctor|check-table-state|google-sheets-check|refactor-checks)\.ts/,
    /`(?:orchestrator|doctor|check-table-state|google-sheets-check|refactor-checks)\.ts`/,
    /`(?:db|dolphin|noco|sheets)\/`/
  ]

  for (const doc of docs) {
    const source = fs.readFileSync(path.join(ROOT, doc), 'utf8')
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${doc} contains stale legacy path or command`)
    }
  }
}

function assertCanonicalEntrypointsLoad(): void {
  assert.ok(require('./cli/orchestrator.ts').runConfiguredOrchestrator)
  assert.ok(require('./orchestrator/client-runner.ts').runClientOrchestrator)
  assert.ok(require('./hh-auth/index.ts').validateAuth)
  assert.ok(require('./auto-responder/browser.ts').ensureIndexScript)
  assert.ok(require('../../platform/browser/page-utils.ts').closePageQuietly)
}

assertCanonicalEntrypointsLoad()
assertNoRawIntegrationImports()
assertArchitectureDocsAreCurrent()

console.log('hh-responses architecture tests passed')

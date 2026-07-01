const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  analyzeRecentRuns,
  analyzeRunFile,
  summarizeAnalyses
} = require('./orchestrator-run-analysis.ts') as {
  analyzeRecentRuns(options?: { logDir?: string; limit?: number }): any[]
  analyzeRunFile(filePath: string): any
  summarizeAnalyses(analyses: any[]): Record<string, unknown>
}

function writeJsonl(dir: string, name: string, records: unknown[]): string {
  const filePath = path.join(dir, name)
  fs.writeFileSync(
    filePath,
    `${records.map(record => JSON.stringify(record)).join('\n')}\n`,
    'utf8'
  )
  return filePath
}

function runTests(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-analysis-'))
  const successFile = writeJsonl(dir, 'orchestrator-run-2026-06-30T00-00-06-000Z-1.jsonl', [
    {
      kind: 'run-start',
      watchMs: 900000,
      responseLimit: 5,
      clients: [{ clientName: 'Kira' }]
    },
    {
      kind: 'client-final-status',
      status: {
        clientName: 'Kira',
        opened: true,
        startButtonClicked: true,
        responseCount: 5,
        requiredResponseLimit: 5,
        autoResponderStopReason: 'limit_reached'
      }
    },
    { kind: 'run-exit', reason: 'success' }
  ])
  writeJsonl(dir, 'orchestrator-run-2026-06-30T00-00-05-000Z-1.jsonl', [
    {
      kind: 'run-start',
      watchMs: 900000,
      responseLimit: 10,
      clients: [{ clientName: 'Manual' }]
    },
    {
      kind: 'client-final-status',
      status: {
        clientName: 'Manual',
        opened: true,
        startButtonClicked: true,
        responseCount: 3,
        manualVacanciesCount: 4,
        autoResponderStopReason: 'manual_targets_only'
      }
    }
  ])
  writeJsonl(dir, 'orchestrator-run-2026-06-30T00-00-04-000Z-1.jsonl', [
    {
      kind: 'run-start',
      watchMs: 900000,
      responseLimit: 10,
      clients: [{ clientName: 'Timeout' }]
    },
    {
      kind: 'client-final-status',
      status: {
        clientName: 'Timeout',
        opened: true,
        startButtonClicked: true,
        responseCount: 2,
        autoResponderStopReason: 'orchestrator_stop_after_watch'
      }
    }
  ])
  writeJsonl(dir, 'orchestrator-run-2026-06-30T00-00-03-000Z-1.jsonl', [
    {
      kind: 'run-start',
      responseLimit: 10,
      clients: [{ clientName: 'Auth' }]
    },
    {
      kind: 'client-final-status',
      status: {
        clientName: 'Auth',
        opened: false,
        startButtonClicked: false,
        responseCount: 0,
        error: 'HH auth validation stayed unknown'
      }
    }
  ])
  writeJsonl(dir, 'orchestrator-run-2026-06-30T00-00-02-000Z-1.jsonl', [
    { kind: 'run-start', clients: [{ clientName: 'Incomplete' }] },
    {
      kind: 'client-lifecycle',
      clientName: 'Incomplete',
      event: { event: 'opening scenario' }
    }
  ])
  writeJsonl(dir, 'orchestrator-run-2026-06-30T00-00-01-000Z-1.jsonl', [
    { kind: 'run-exit', reason: 'fatal-error', exitCode: 1 }
  ])

  const success = analyzeRunFile(successFile)
  assert.equal(success.clients[0].metResponseLimit, true)
  assert.equal(success.clients[0].completionGap, 'met_response_limit')

  const analyses = analyzeRecentRuns({ logDir: dir, limit: 10 })
  const summary = summarizeAnalyses(analyses)
  assert.equal(analyses.length, 6)
  assert.equal(summary.files, 6)
  assert.equal(summary.metResponseLimit, 1)
  assert.equal(summary.incompleteRuns, 2)
  assert.equal(
    analyses.some(run =>
      run.clients.some((client: any) =>
        String(client.suggestedFix).includes('skip/save manual response pages')
      )
    ),
    true
  )
  assert.equal(
    analyses.some(run =>
      run.clients.some((client: any) =>
        String(client.suggestedFix).includes('Increase watchMs')
      )
    ),
    true
  )
  assert.equal(
    analyses.some(run =>
      run.clients.some((client: any) =>
        String(client.suggestedFix).includes('auth preflight')
      )
    ),
    true
  )
}

runTests()
console.log('orchestrator run analysis tests passed')

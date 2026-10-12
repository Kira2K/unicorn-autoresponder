import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { collectVacancies } from '../vacancy_collection/index.ts'

test('CLI stages consume saved artifacts independently; incomplete collections cannot open application forms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-pipeline-cli-'))
  const cli = fileURLToPath(new URL('../cli.ts', import.meta.url))
  const run = (...args: string[]) => promisify(execFile)(process.execPath, [cli, ...args, '--storage', join(root, 'state'), '--logs', join(root, 'logs')], { windowsHide: true })
  try {
    const source = { name: 'Fixture', url: 'https://fixture.test/jobs' }
    const collection = await collectVacancies({ runId: 'fixture', sources: [source] }, { strategy: { name: 'mock', discover: async () => ({
      audit: [{ source, status: 'complete', pages: [source.url], found: 1, issues: [] }],
      positions: [{ id: '', company: source.name, title: 'Senior Java Backend Engineer', description: 'Build backend services with Java and Spring.', location: 'Spain', url: source.url + '/1', applyUrl: source.url + '/1', source, retrievedAt: '' }]
    }) } })
    const collected = join(root, 'collected.json'), classified = join(root, 'classified.json')
    await writeFile(collected, JSON.stringify(collection))
    await run('classify', '--input', collected, '--stacks', 'java', '--out', classified, '--offline', '--no-ai')
    const result = JSON.parse(await readFile(classified, 'utf8'))
    assert.equal(result.readyForApplications, true)
    assert.match(result.selectionRules.source, /vacancy-selection[\\/]SKILL\.md$/)
    assert.equal(result.groups.java.reviewIds.length, 1, 'No AI cannot silently pass editable global rules')
    await run('report-collection', '--input', classified, '--out', join(root, 'report'), '--offline')
    assert.match(await readFile(join(root, 'report', 'report.md'), 'utf8'), /Ready for applications: yes/)

    const pdf = join(root, 'cv.pdf'), intake = join(root, 'intake.json'), matches = join(root, 'matches.json')
    await writeFile(pdf, '%PDF-1.4 fixture')
    await writeFile(intake, JSON.stringify({ cvPath: pdf, criteria: { titles: ['backend'] }, stackIds: ['java'] }))
    await run('intake', '--candidate', 'student', '--input', intake, '--no-ai')
    const restrictions = join(root, 'restrictions.json')
    await writeFile(restrictions, JSON.stringify({ studentId: 'student', complete: true, checkedAt: new Date().toISOString(), rules: [] }))
    await run('match', '--candidate', 'student', '--collection', classified, '--stack', 'java', '--out', matches, '--no-ai', '--offline', '--restrictions', restrictions)
    assert.equal(JSON.parse(await readFile(matches, 'utf8')).positions.length, 0)

    collection.audit[0].status = 'partial'
    collection.audit[0].terminal = false
    await writeFile(collected, JSON.stringify(collection))
    await run('classify', '--input', collected, '--stacks', 'java', '--out', classified, '--offline', '--no-ai')
    await assert.rejects(run('prepare', '--candidate', 'student', '--collection', classified, '--stack', 'java', '--input', matches, '--batch', 'fixture', '--limit', '1', '--no-ai', '--offline'), /collection_incomplete/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

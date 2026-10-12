import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { loadSelectionRules, assertCurrentSelectionRules } from '../stack_classification/rules.ts'
import { createGlobalAssessor } from '../stack_classification/global-ai.ts'
import { classifyVacancies, assertClassificationIntegrity } from '../stack_classification/index.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import type { Client } from '../infrastructure/ai.ts'
import type { Position } from '../types.ts'

async function fixture() {
  const source = { name: 'Example', url: 'https://example.test/jobs' }
  const roles = [['Low salary', 'USD 2,000 gross per month. Java Spring backend.'], ['Accepted', 'USD 5,000 gross per month. Java Spring backend.'], ['No salary', 'Java Spring backend.'], ['Missing body', '']]
  const positions: Position[] = roles.map(([title, description], i) => ({ id: String(i), company: source.name, title, description: description ? description + ' Responsibilities include building production APIs, maintaining backend services and databases, and collaborating with the product engineering team.' : '', location: 'Worldwide', url: source.url + '/' + i, applyUrl: source.url + '/' + i, retrievedAt: '', source }))
  return collectVacancies({ runId: 'global-rules', sources: [source] }, { strategy: { name: 'fixture', discover: async () => ({ positions, audit: [{ source, status: 'complete', pages: [source.url], found: positions.length, issues: [] }] }) } })
}
const stacks = [{ id: 'java', name: 'Java', description: 'Java Spring backend.' }, { id: 'jvm', name: 'JVM', description: 'JVM backend.' }]

test('editable skill is loaded independently; comments are inactive, missing/empty files fail, rule edits invalidate decisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-rules-'))
  try {
    const path = join(root, 'SKILL.md')
    await writeFile(path, '---\nname: example\n---\n# Rules\n- No internships.\n<!-- Inactive salary example -->')
    const first = await loadSelectionRules(path)
    assert.equal(first.text, '# Rules\n- No internships.')
    assertCurrentSelectionRules(first, await loadSelectionRules(path))
    await writeFile(path, '# Rules\n- No internships.\n<!-- Changed comment -->')
    assertCurrentSelectionRules(first, await loadSelectionRules(path))
    await writeFile(path, '# Rules\n- No internships or junior jobs.')
    assert.throws(() => assertCurrentSelectionRules(first, { ...first, text: 'tampered' }), /invalid/)
    const changed = await loadSelectionRules(path)
    assert.throws(() => assertCurrentSelectionRules(first, changed), /rules_changed/)
    assert.throws(() => assertCurrentSelectionRules(undefined, changed), /rules_required/)
    await writeFile(path, '<!-- no rules -->')
    await assert.rejects(loadSelectionRules(path), /rules_invalid/)
    await assert.rejects(loadSelectionRules(join(root, 'missing.md')), /ENOENT/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('global decisions run once per vacancy; only global passes reach stack matching and rejection cannot be bypassed', async () => {
  const collection = await fixture(), selectionRules = await loadSelectionRules()
  let globalCalls = 0, stackCalls = 0
  const result = await classifyVacancies({ collection, stacks, selectionRules }, {
    assessGlobal: async (position, rules) => { globalCalls++; assert.equal(rules.sha256, selectionRules.sha256); return { decision: position.title === 'Low salary' ? 'excluded' : 'eligible', reasons: ['Mock policy decision'], evidence: [position.description] } },
    assess: async position => { stackCalls++; assert.notEqual(position.title, 'Low salary'); return { decision: 'eligible', reasons: ['Matches stack'], evidence: [position.description] } }
  })
  assert.equal(globalCalls, 3); assert.equal(stackCalls, 4)
  assert.equal(result.groups.java.matchedIds.length, 2)
  assert.equal(result.groups.java.excludedIds.length, 1)
  assert.equal(result.groups.java.reviewIds.length, 1)
  assertClassificationIntegrity(result)
  const missingAssessor = await classifyVacancies({ collection, stacks, selectionRules }, { assess: async () => { throw Error('Must not reach stacks') } })
  assert.equal(missingAssessor.groups.java.matchedIds.length, 0)
  const failed = await classifyVacancies({ collection, stacks, selectionRules }, { assessGlobal: async () => { throw Error('Unavailable') } })
  assert.equal(failed.groups.java.reviewIds.length, 4)
  const tampered = structuredClone(result), acceptedId = tampered.groups.java.matchedIds[0]
  tampered.globalDecisions![acceptedId].decision = 'excluded'
  const { digest, ...content } = tampered
  tampered.digest = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  assert.throws(() => assertClassificationIntegrity(tampered), /global_selection/)
})

test('global AI receives editable rules and posting only, without candidate data or inactive examples', async () => {
  const rules = await loadSelectionRules(), position = (await fixture()).positions[0]
  let payload: any
  const client = { respond: async (messages: { content: string }[]) => { payload = JSON.parse(messages[0].content); return { decision: 'eligible', reasons: ['Fixture'], evidence: [position.description] } } } as unknown as Client
  await createGlobalAssessor(client)(position, rules)
  assert.equal(payload.selectionRules, rules.text)
  assert(!payload.selectionRules.includes('Salary example'))
  assert.deepEqual(Object.keys(payload).sort(), ['selectionRules', 'vacancy'])
  assert.equal(payload.vacancy.description, position.description)
})

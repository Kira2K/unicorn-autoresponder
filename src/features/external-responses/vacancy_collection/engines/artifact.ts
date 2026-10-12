import { createHash } from 'node:crypto'
import { evaluateEngine } from './runtime.ts'
import type { EngineArtifact, EngineFixture, EngineFixtureEvidence, EngineResult, EngineRuntimeOptions } from './types.ts'

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}

function assertFixture(result: EngineResult, fixture: EngineFixture) {
  const expected = fixture.expected
  if (result.kind !== expected.kind) throw Error(`engine_fixture_kind_mismatch:${fixture.name}`)
  const urls = result.kind === 'plan' ? result.value.entryUrls : result.value.jobs.map(job => job.url)
  if (expected.entryUrls && !expected.entryUrls.every(url => result.kind === 'plan' && result.value.entryUrls.includes(url))) throw Error(`engine_fixture_entry_url_missing:${fixture.name}`)
  if (expected.jobUrls && !expected.jobUrls.every(url => result.kind === 'parse' && result.value.jobs.some(job => job.url === url))) throw Error(`engine_fixture_job_url_missing:${fixture.name}`)
  if (expected.excludedJobUrls && expected.excludedJobUrls.some(url => result.kind !== 'parse' || result.value.jobs.some(job => job.url === url))) throw Error(`engine_fixture_excluded_job_present:${fixture.name}`)
  if (expected.minimumJobs !== undefined && (result.kind !== 'parse' || result.value.jobs.length < expected.minimumJobs)) throw Error(`engine_fixture_job_count_failed:${fixture.name}`)
  const body = result.kind === 'parse' ? [result.value.text, ...result.value.jobs.flatMap(job => [job.title, job.description])].join('\n') : urls.join('\n')
  if (expected.substantiveText && !expected.substantiveText.every(text => body.includes(text))) throw Error(`engine_fixture_text_missing:${fixture.name}`)
}

export async function runEngineFixtures(code: string, fixtures: EngineFixture[], limits: EngineRuntimeOptions): Promise<EngineFixtureEvidence[]> {
  if (!fixtures.length) throw Error('engine_fixtures_required')
  const names = new Set<string>()
  const evidence: EngineFixtureEvidence[] = []
  for (const fixture of fixtures) {
    if (!fixture.name.trim() || names.has(fixture.name)) throw Error('engine_fixture_names_must_be_unique')
    names.add(fixture.name)
    const result = await evaluateEngine(code, fixture.input, limits)
    assertFixture(result, fixture)
    evidence.push({ name: fixture.name, inputSha256: sha256(stableJson(fixture.input)), outputSha256: sha256(stableJson(result)) })
  }
  return evidence
}

export async function buildEngineArtifact(input: Omit<EngineArtifact, 'sha256' | 'fixtures'>, fixtures: EngineFixture[], limits: EngineRuntimeOptions): Promise<EngineArtifact> {
  const evidence = await runEngineFixtures(input.code, fixtures, limits)
  return { ...input, sha256: sha256(input.code), fixtures: evidence }
}

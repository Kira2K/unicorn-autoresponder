import { assertAllowedUrl } from '../../infrastructure/navigation-policy.ts'
import { descriptionIssue } from '../description-quality.ts'
import type { ControlStep } from '../source-memory.ts'
import type { EngineInput, EngineJob, EngineLiveEvidence, EngineParseResult, EnginePlan, EngineResult } from './types.ts'

const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)
const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`engine_${name}_must_be_object`)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, allowed: readonly string[], name: string) => {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key))
  if (unexpected) throw Error(`engine_${name}_unexpected_field:${unexpected}`)
}
const string = (value: unknown, name: string, allowEmpty = false) => {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw Error(`engine_${name}_must_be_string`)
  return value
}
const url = (value: unknown, name: string) => {
  const result = string(value, name)
  assertAllowedUrl(result)
  const protocol = new URL(result).protocol
  if (protocol !== 'https:' && protocol !== 'http:') throw Error(`engine_${name}_must_be_http_url`)
  return result
}
const strings = (value: unknown, name: string) => {
  if (!Array.isArray(value)) throw Error(`engine_${name}_must_be_array`)
  return value.map((item, index) => string(item, `${name}_${index}`))
}

function controlStep(value: unknown, name: string): ControlStep {
  const item = record(value, name)
  exact(item, ['operation', 'role', 'name', 'selector', 'value'], name)
  if (item.operation !== 'click' && item.operation !== 'clear_search' && item.operation !== 'fill_search') throw Error(`engine_${name}_invalid_operation`)
  if (item.role !== undefined && item.role !== 'button' && item.role !== 'link') throw Error(`engine_${name}_invalid_role`)
  for (const key of ['name', 'selector', 'value'] as const) if (item[key] !== undefined) string(item[key], `${name}_${key}`)
  if (item.operation === 'fill_search' && (typeof item.selector !== 'string' || typeof item.value !== 'string' || !item.value.trim() || item.value.length > 100 || item.role !== undefined || item.name !== undefined)) throw Error(`engine_${name}_invalid_search_fill`)
  return item as ControlStep
}

function job(value: unknown, name: string): EngineJob {
  const item = record(value, name)
  exact(item, ['title', 'location', 'description', 'url', 'applyUrl', 'publicationLabels', 'publishedAt'], name)
  const result: EngineJob = {
    title: string(item.title, `${name}_title`),
    location: string(item.location, `${name}_location`, true),
    description: string(item.description, `${name}_description`),
    url: url(item.url, `${name}_url`),
    applyUrl: url(item.applyUrl, `${name}_apply_url`)
  }
  if (item.publicationLabels !== undefined) result.publicationLabels = strings(item.publicationLabels, `${name}_publication_labels`)
  if (item.publishedAt !== undefined) result.publishedAt = string(item.publishedAt, `${name}_published_at`)
  return result
}

export function validateEngineInput(value: unknown): EngineInput {
  const input = record(value, 'input')
  exact(input, ['sourceId', 'url', 'text', 'links', 'jobs', 'meta'], 'input')
  if (!Array.isArray(input.links) || !Array.isArray(input.jobs)) throw Error('engine_input_links_and_jobs_must_be_arrays')
  const links = input.links.map((value, index) => {
    const link = record(value, `input_link_${index}`)
    exact(link, ['text', 'url'], `input_link_${index}`)
    return { text: string(link.text, `input_link_${index}_text`, true), url: url(link.url, `input_link_${index}_url`) }
  })
  if (input.meta !== undefined) {
    const meta = record(input.meta, 'input_meta')
    for (const [key, item] of Object.entries(meta)) if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) throw Error(`engine_input_meta_invalid:${key}`)
  }
  return {
    sourceId: string(input.sourceId, 'input_source_id'),
    url: url(input.url, 'input_url'),
    text: string(input.text, 'input_text', true),
    links,
    jobs: input.jobs.map((value, index) => job(value, `input_job_${index}`)),
    ...(input.meta === undefined ? {} : { meta: input.meta as EngineInput['meta'] })
  }
}

function plan(value: unknown): EnginePlan {
  const item = record(value, 'plan')
  exact(item, ['entryUrls', 'reads', 'extraction'], 'plan')
  if (!Array.isArray(item.entryUrls) || !item.entryUrls.length) throw Error('engine_plan_entry_urls_must_be_nonempty_array')
  const result: EnginePlan = { entryUrls: item.entryUrls.map((entry, index) => url(entry, `plan_entry_${index}`)) }
  if (item.reads !== undefined) {
    if (!Array.isArray(item.reads)) throw Error('engine_plan_reads_must_be_array')
    result.reads = item.reads.map((value, index) => {
      const read = record(value, `plan_read_${index}`)
      exact(read, ['url', 'steps'], `plan_read_${index}`)
      if (read.steps !== undefined && !Array.isArray(read.steps)) throw Error(`engine_plan_read_${index}_steps_must_be_array`)
      return { url: url(read.url, `plan_read_${index}_url`), ...(read.steps === undefined ? {} : { steps: read.steps.map((step, stepIndex) => controlStep(step, `plan_read_${index}_step_${stepIndex}`)) }) }
    })
  }
  if (item.extraction !== undefined) {
    const extraction = record(item.extraction, 'plan_extraction')
    const fields = ['listingSelector', 'detailLinkSelector', 'titleSelector', 'locationSelector', 'descriptionSelector', 'paginationSelector', 'emptyStateSelector'] as const
    exact(extraction, fields, 'plan_extraction')
    result.extraction = {}
    for (const field of fields) if (extraction[field] !== undefined) result.extraction[field] = string(extraction[field], `plan_extraction_${field}`)
  }
  return result
}

export function validateEngineParseResult(value: unknown): EngineParseResult {
  const item = record(value, 'parse')
  exact(item, ['url', 'text', 'links', 'jobs'], 'parse')
  if (!Array.isArray(item.links) || !Array.isArray(item.jobs)) throw Error('engine_parse_links_and_jobs_must_be_arrays')
  const links = item.links.map((value, index) => {
    const link = record(value, `parse_link_${index}`)
    exact(link, ['text', 'url'], `parse_link_${index}`)
    return { text: string(link.text, `parse_link_${index}_text`, true), url: url(link.url, `parse_link_${index}_url`) }
  })
  return {
    url: url(item.url, 'parse_url'),
    text: string(item.text, 'parse_text', true),
    links,
    jobs: item.jobs.map((value, index) => job(value, `parse_job_${index}`))
  }
}

export function validateEngineResult(value: unknown): EngineResult {
  const result = record(value, 'result')
  exact(result, ['kind', 'value'], 'result')
  if (result.kind === 'plan') return { kind: 'plan', value: plan(result.value) }
  if (result.kind === 'parse') return { kind: 'parse', value: validateEngineParseResult(result.value) }
  throw Error('engine_result_invalid_kind')
}

export function assertCompleteLiveResult(document: EngineParseResult, evidence: EngineLiveEvidence) {
  if (evidence.coverage !== 'complete' || evidence.paginationComplete !== true) throw Error('engine_live_result_not_complete')
  if (!document.jobs.length && !evidence.explicitlyEmpty) throw Error('engine_live_result_has_no_empty_state_evidence')
  if (document.jobs.length && evidence.explicitlyEmpty) throw Error('engine_live_result_conflicting_empty_state')
  for (const vacancy of document.jobs) {
    const issue = descriptionIssue(vacancy.description)
    if (issue) throw Error(`engine_live_result_${issue}:${vacancy.url}`)
  }
}

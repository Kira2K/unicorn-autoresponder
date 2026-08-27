import { finalizeGeneratedOutput } from './clean-output.ts'
import { logAction } from '../log-action.ts'
import type { ProfileLogger } from '../profile-logger.ts'
import { CV_FACTS_SCHEMA } from './facts-schema.ts'
import { assertCvFacts } from './facts-validation.ts'
import { GENERATION_RULES } from './guide-rules.ts'
import { createOpenAiHttp } from './openai-http.ts'
import { GENERATED_PROFILE_SCHEMA } from './profile-schema.ts'
import { JOB_TITLE_CHOICE_SCHEMA } from './job-title-choice-schema.ts'
import type { CvDocument, CvFacts, JobTitleChoice, JobTitleChoiceRequest } from './types.ts'
import type { ValidationIssue } from '../input-types.ts'
import { mergeRepair, repairSchema, repairSections } from './repair-schema.ts'

const FACT_INSTRUCTIONS = `Extract facts from the attached final English CV. Preserve every
employment position, company, title, date, education record, metric, contact and technology.
Do not invent, infer, improve or summarize facts. Evidence must be a short CV-grounded
paraphrase, not a long quotation. Dates use YYYY-MM or null.`

const TITLE_INSTRUCTIONS = `For each requested LinkedIn role, choose the closest semantic match
from supplied catalog candidates. Never invent or rewrite a candidate. Return its exact
candidate_id and confident=true. Every role must receive a distinct candidate when enough distinct
candidates exist. Return null and false when no candidate is a plausible semantic match.`
const REPAIR_INSTRUCTIONS = `Repair only the supplied profile sections. Obey the output schema
and listed validation issues. Use only supplied CV facts; never invent employment, education,
dates, metrics or contacts. Return no sections beyond the schema.`

function parseChoices(value: any): JobTitleChoice[] {
  if (!Array.isArray(value?.choices)) return []
  return value.choices.flatMap((item: any) => Number.isInteger(item?.index) &&
    (typeof item.candidate_id === 'string' || item.candidate_id === null) &&
    typeof item.confident === 'boolean' ? [{ index: item.index,
      candidateId: item.candidate_id, confident: item.confident }] : [])
}

export function createProfileGenerator(options: {
  apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number
  fetchImpl?: typeof fetch; baseUrl?: string; logger?: ProfileLogger
  retrySleep?: (milliseconds: number) => Promise<void>; retryRandom?: () => number
}) {
  const client = createOpenAiHttp(options)
  async function extractFacts(cv: CvDocument) {
    const fileId = await client.upload(cv.bytes, cv.fileName, cv.mimeType)
    try {
      const input = [{ role: 'user', content: [
        { type: 'input_file', file_id: fileId },
        { type: 'input_text', text: 'Extract the CV facts into the required schema.' }
      ] }]
      const response = await client.respond(input, 'linkedin_cv_facts', CV_FACTS_SCHEMA,
        FACT_INSTRUCTIONS)
      return options.logger ? await logAction(options.logger, 'cv_facts_validation', () =>
        assertCvFacts(response)) : assertCvFacts(response)
    } finally { await client.remove(fileId) }
  }
  async function generateProfile(facts: CvFacts, proxyCountry: string) {
    const context = { facts, proxy_country: proxyCountry }
    const input = [{ role: 'user', content: [{ type: 'input_text',
      text: `Build the profile from this trusted fact set only:\n${JSON.stringify(context)}` }] }]
    const response = await client.respond(input, 'linkedin_profile',
      GENERATED_PROFILE_SCHEMA, GENERATION_RULES)
    return options.logger ? await logAction(options.logger, 'generated_output_cleanup', () =>
      finalizeGeneratedOutput(response)) : finalizeGeneratedOutput(response)
  }
  async function chooseJobTitles(requests: JobTitleChoiceRequest[]) {
    const input = [{ role: 'user', content: [{ type: 'input_text',
      text: JSON.stringify({ requests }) }] }]
    const choose = () => client.respond(input, 'linkedin_job_title_choices',
      JOB_TITLE_CHOICE_SCHEMA, TITLE_INSTRUCTIONS, 1_200)
    let response
    try { response = await choose() }
    catch (error: any) {
      if (error?.code !== 'openai_response_incomplete') throw error
      response = await choose()
    }
    return parseChoices(response)
  }
  async function repairProfile(document: any, facts: CvFacts, proxyCountry: string,
    issues: ValidationIssue[]) {
    const sections = repairSections(issues)
    if (!sections.length) return document
    const current = Object.fromEntries(sections.map(section => [section,
      document?.profile?.[section === 'about_blocks' ? 'about' : section]]))
    const input = [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({
      current, issues: issues.map(item => ({ path: item.path, message: item.message })),
      facts, proxy_country: proxyCountry
    }) }] }]
    const response = await client.respond(input, 'linkedin_profile_repair',
      repairSchema(sections), REPAIR_INSTRUCTIONS, 4_000)
    const repaired = finalizeGeneratedOutput(response)
    return mergeRepair(document, repaired, sections)
  }
  return { chooseJobTitles, extractFacts, generateProfile, repairProfile }
}

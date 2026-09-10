import { factsSchema } from './openai-schema.ts'
import { PostError, object } from './errors.ts'
import type { FactsExtractor, ModelResponder } from './source-types.ts'
import { FACT_INSTRUCTIONS, FACTS_VERSION } from './fact-instructions.ts'

export function createFactsExtractor(respond: ModelResponder): FactsExtractor {
  return async document => {
    const value = object(await respond([{ role: 'user', content: [
      { type: 'input_file', filename: document.fileName ?? 'cv.pdf',
        file_data: `data:${document.mimeType ?? 'application/pdf'};base64,${document.bytes.toString('base64')}` },
      { type: 'input_text', text: 'Extract all professional experience facts with their source evidence.' }
    ] }], factsSchema, FACT_INSTRUCTIONS))
    if (typeof value.role !== 'string' || !value.role || !Array.isArray(value.stack) ||
      !value.stack.every(item => typeof item === 'string') || !Array.isArray(value.facts) ||
      !value.facts.length) throw new PostError('post_facts_missing')
    const facts = value.facts.map((item, index) => {
      const fact = object(item)
      if (typeof fact.text !== 'string' || !fact.text.trim() || typeof fact.evidence !== 'string' ||
        !fact.evidence.trim()) throw new PostError('post_facts_invalid')
      return { id: `fact_${index + 1}`, text: fact.text, evidence: fact.evidence }
    })
    return { role: value.role, stack: value.stack, facts, factsVersion: FACTS_VERSION }
  }
}

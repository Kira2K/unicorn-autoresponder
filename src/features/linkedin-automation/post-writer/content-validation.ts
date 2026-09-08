import { PostError, object } from './errors.ts'
import { contentHash, normalized } from './content-identity.ts'
import type { Context, Draft, ContentHistory, Topic } from './writer-types.ts'
import { similar } from './novelty.ts'
import { POST_LENGTH, postLength } from './post-length.ts'

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim())
}
export function parseTopics(value: unknown, context: Context, history: ContentHistory[]): Topic[] {
  const rows = object(value).topics
  if (!Array.isArray(rows) || rows.length < 3 || rows.length > 5) throw new PostError('post_topics_invalid')
  const known = new Set(context.facts.map(fact => fact.id))
  const result = rows.map(row => {
    const item = object(row)
    if (typeof item.title !== 'string' || !item.title.trim() || typeof item.signature !== 'string' ||
      !item.signature.trim() || !strings(item.factIds) || !item.factIds.length ||
      item.factIds.some(id => !known.has(id)) || typeof item.score !== 'number' ||
      !Number.isFinite(item.score)) throw new PostError('post_topics_invalid')
    return item as Topic
  })
  const used = new Set(history.map(row => normalized(row.signature).toLowerCase()))
  return result.filter(topic => !used.has(normalized(topic.signature).toLowerCase()) &&
    !history.some(row => similar(row.signature, topic.signature)))
    .sort((a, b) => b.score - a.score)
}
export function parseDraft(value: unknown): Draft {
  const item = object(value)
  if (typeof item.text !== 'string' || !strings(item.factIds) || !Array.isArray(item.claims) ||
    item.claims.some(claim => typeof claim?.text !== 'string' || typeof claim?.factId !== 'string')) {
    throw new PostError('post_draft_invalid')
  }
  return item as Draft
}
export function validateDraft(draft: Draft, context: Context, history: ContentHistory[]): string[] {
  const issues: string[] = []
  const text = draft.text.trim()
  const facts = new Map(context.facts.map(fact => [fact.id, fact]))
  const length = postLength(text)
  if (length < POST_LENGTH.min || length > POST_LENGTH.max) issues.push('length_900_1100')
  const tags = text.match(/#[a-z][a-z0-9_]*/gi) ?? []
  if (tags.length < 4 || tags.length > 5 || new Set(tags.map(tag => tag.toLowerCase())).size !== tags.length) {
    issues.push('hashtags_4_5')
  }
  if (/[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\p{S}\s]/u.test(text) ||
    !/\b(the|a|an|is|are|to|with|for|my|our|I)\b/.test(text)) issues.push('english_required')
  if (text.split(/\n\s*\n/).length < 4 || !text.includes('?')) issues.push('post_structure')
  if (/in today.s fast.paced|game.changer|delve into|thrilled to announce|agree\?|thoughts\?/i.test(text)) {
    issues.push('template_language')
  }
  if (/https?:|www\.|\S+@\S+|\p{Extended_Pictographic}/u.test(text)) issues.push('links_contacts_emoji')
  if (!draft.factIds.length || new Set(draft.factIds).size !== draft.factIds.length ||
    draft.factIds.some(id => !facts.has(id))) issues.push('unknown_or_duplicate_fact')
  if (!draft.claims.length || draft.claims.some(claim => !text.includes(claim.text) ||
    !draft.factIds.includes(claim.factId) || !facts.has(claim.factId))) issues.push('ungrounded_claim')
  const source = draft.factIds.map(id => facts.get(id)?.text ?? '').join(' ')
  const numbers = new Set(source.match(/\d+(?:[.,]\d+)?/g) ?? [])
  if ((text.match(/\d+(?:[.,]\d+)?/g) ?? []).some(number => !numbers.has(number))) {
    issues.push('unsupported_number')
  }
  if (draft.claims.some(claim => (claim.text.match(/\d+(?:[.,]\d+)?/g) ?? []).some(number =>
    !new Set(facts.get(claim.factId)?.text.match(/\d+(?:[.,]\d+)?/g) ?? []).has(number)))) {
    issues.push('claim_number_not_in_cited_fact')
  }
  if (history.some(row => row.hash === contentHash(text) || similar(row.text, text))) issues.push('duplicate_content')
  return issues
}

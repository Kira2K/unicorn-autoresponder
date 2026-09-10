import { PostError, object } from './errors.ts'
import { digest, normalized } from './content-identity.ts'
import type { WriterModel, Context, Topic } from './writer-types.ts'
export type ContentRules = { requestedTopic?: string; forbiddenTopics?: string[] }
export function topicList(value: unknown, maximum = 50): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some(item =>
    typeof item !== 'string' || !item.trim() || item.length > 500)) throw new PostError('post_topic_rules_invalid')
  return [...new Set(value.map(item => normalized(item)))].sort()
}
export function customTopic(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new PostError('post_topic_invalid')
  return normalized(value)
}
export const rulesKey = (rules: ContentRules) => digest(JSON.stringify({
  requestedTopic: rules.requestedTopic ?? '', forbiddenTopics: [...(rules.forbiddenTopics ?? [])].sort() }))
export const needsReview = (rules: ContentRules) => Boolean(rules.requestedTopic || rules.forbiddenTopics?.length)
export async function reviewRules(model: WriterModel, context: Context, topic: Topic,
  rules: ContentRules, text?: string): Promise<string[]> {
  if (!needsReview(rules)) return []
  if (!model.review) return ['post_policy_review_unavailable']
  const raw = await model.review(structuredClone(context), structuredClone({ topic, text, rules }))
  let result: Record<string, unknown>
  try { result = object(raw) } catch { return ['post_policy_review_invalid'] }
  if (typeof result.allowed !== 'boolean' || typeof result.uncertain !== 'boolean' ||
    typeof result.onTopic !== 'boolean') return ['post_policy_review_invalid']
  return [...(!result.allowed ? ['post_topic_forbidden'] : []),
    ...(result.uncertain ? ['post_policy_uncertain'] : []),
    ...(!result.onTopic ? ['post_custom_topic_mismatch'] : [])]
}

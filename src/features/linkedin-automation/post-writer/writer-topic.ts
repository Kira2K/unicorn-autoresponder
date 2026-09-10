import { parseTopics } from './content-validation.ts'
import { normalized } from './content-identity.ts'
import { similar } from './novelty.ts'
import { customTopic, reviewRules } from './content-rules.ts'
import type { WriterInput, WriterModel, Topic } from './writer-types.ts'
import { PostError } from './errors.ts'

export async function selectWriterTopic(input: WriterInput, model: WriterModel, stopped = () => false): Promise<Topic[]> {
  const { context, history, rules = {} } = input
  const requested = customTopic(rules.requestedTopic)
  const topics = requested ? [{ title: requested, signature: requested,
    factIds: context.facts.map(fact => fact.id), score: 100 }] :
    parseTopics(await model.topics(structuredClone(context), structuredClone(history), structuredClone(rules)), context, history)
  if (requested && history.some(item => normalized(item.signature) === requested || similar(item.signature, requested))) {
    throw new PostError('post_topics_repeated')
  }
  for (const topic of topics) {
    if (stopped()) return []
    const issues = await reviewRules(model, context, topic, rules)
    if (!issues.length) return [topic, ...topics.filter(item => item !== topic)]
    if (requested || issues.some(issue => issue !== 'post_topic_forbidden')) throw new PostError(issues[0])
  }
  if (topics.length) throw new PostError('post_topic_forbidden')
  return []
}

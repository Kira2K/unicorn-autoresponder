import { parseDraft, validateDraft } from './content-validation.ts'
import { errorCode } from './errors.ts'
import { reserveRepair } from './reserve-repair.ts'
import type { WriterCheckpoint, WriterInput, WriterModel, WriterOptions, WriterResult } from './writer-types.ts'
import { selectWriterTopic } from './writer-topic.ts'
import { reviewRules, rulesKey, needsReview } from './content-rules.ts'
import { digest } from './content-identity.ts'

const MAX_REPAIRS = 2

export async function writePost(input: WriterInput, model: WriterModel,
  options: WriterOptions = {}): Promise<WriterResult> {
  const { context, history, rules = {} } = structuredClone(input)
  const state: WriterCheckpoint = structuredClone(options.checkpoint ?? { repairCount: 0, issues: [] })
  const stopped = () => options.signal?.aborted === true
  const cancelled = (): WriterResult => ({ status: 'cancelled', checkpoint: structuredClone(state) })
  const blocked = (issues: string[]): WriterResult => ({ status: 'blocked',
    checkpoint: structuredClone({ ...state, issues }) })
  const checkpoint = async () => { await options.onCheckpoint?.(structuredClone(state)) }
  const request = async (invoke: () => Promise<unknown>) => {
    try { return await invoke() }
    catch (error) { if (!stopped()) throw error }
  }
  if (stopped()) return cancelled()
  if (!context.facts.length) return blocked(['post_facts_missing'])
  if (!Number.isInteger(state.repairCount) || state.repairCount < 0 || state.repairCount > MAX_REPAIRS) {
    return blocked(['post_checkpoint_invalid'])
  }
  if (!state.topic) {
    try { state.topics = await selectWriterTopic({ context, history, rules }, model, stopped) }
    catch (error) {
      if (stopped()) return cancelled()
      if (errorCode(error) === 'invalid_shape' || /^post_(topics_|topic_forbidden|policy_|custom_topic)/.test(errorCode(error))) return blocked([errorCode(error)])
      throw error
    }
    if (stopped()) return cancelled()
    state.topic = state.topics[0]
    if (!state.topic) return blocked(['post_topics_repeated'])
    await checkpoint()
  }
  // A saved draft is rechecked locally, never regenerated merely because of restart.
  if (state.draft) state.issues = validateDraft(state.draft, context, history)
  while (!stopped()) {
    if (state.draft && !state.issues.length) {
      const reviewedKey = digest(`${rulesKey(rules)}:${JSON.stringify(context)}:${state.topic.title}:${state.draft.text}`)
      if (needsReview(rules) && state.reviewedKey !== reviewedKey) {
        state.issues = await reviewRules(model, context, state.topic, rules, state.draft.text)
        if (stopped()) return cancelled()
        if (state.issues.some(issue => /uncertain|invalid|unavailable/.test(issue))) return blocked(state.issues)
        if (!state.issues.length) { state.reviewedKey = reviewedKey; await checkpoint() }
      }
      if (!state.issues.length) return { status: 'ready', checkpoint: structuredClone({ ...state,
        topic: state.topic, draft: state.draft }) }
    }
    const repairing = Boolean(state.draft) || state.issues.length > 0
    if (repairing) {
      if (state.repairCount >= MAX_REPAIRS) return blocked(state.issues)
      // Reserve before requesting: a lost response must not reset the total budget.
      await reserveRepair(state, checkpoint)
    }
    if (stopped()) return cancelled()
    const topic = state.topic
    const value = await request(() => model.draft(structuredClone(context), structuredClone(topic),
      structuredClone(state.draft), [...state.issues], structuredClone(rules)))
    if (stopped()) return cancelled()
    try {
      state.draft = parseDraft(structuredClone(value))
      state.issues = validateDraft(state.draft, context, history)
    } catch (error) {
      if (errorCode(error) === 'invalid_shape') return blocked(['invalid_shape'])
      if (errorCode(error) !== 'post_draft_invalid') throw error
      state.issues = ['post_draft_invalid']
    }
  }
  return cancelled()
}

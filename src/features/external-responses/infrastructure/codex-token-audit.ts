type Usage = { input: number; cachedInput: number; uncachedInput: number; output: number; reasoningSubset: number; responses: number }
export type TokenAuditSource = { label: string; phase: 'development' | 'runtime'; model: string; events: AsyncIterable<unknown> }
const empty = (): Usage => ({ input: 0, cachedInput: 0, uncachedInput: 0, output: 0, reasoningSubset: 0, responses: 0 })
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0

/** Reads only per-response usage events in an explicit interval. No prompts, cumulative totals or quota estimates. */
export async function auditCodexTokens(input: { from: string; to: string; sources: TokenAuditSource[] }) {
  const from = Date.parse(input.from), to = Date.parse(input.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw Error('invalid_audit_interval')
  const seen = new Set<string>(), groups: Record<string, Usage & { phase: string; model: string }> = {}, total = empty()
  let duplicateEvents = 0, invalidEvents = 0
  for (const source of input.sources) {
    const group = groups[source.label] ??= { ...empty(), phase: source.phase, model: source.model }
    if (group.phase !== source.phase || group.model !== source.model) throw Error('conflicting_audit_source_label')
    for await (const raw of source.events) {
      const event = raw as any
      if (event?.type !== 'token_usage_record') continue
      const at = Date.parse(event.timestamp)
      if (!Number.isFinite(at) || at < from || at > to) continue
      const p = event.payload, u = p?.usage, id = p?.response_id
      if (typeof id !== 'string' || !id || !u || !count(u.input_tokens) || !count(u.cached_input_tokens) ||
          !count(u.output_tokens) || !count(u.reasoning_output_tokens) || u.cached_input_tokens > u.input_tokens ||
          u.reasoning_output_tokens > u.output_tokens) { invalidEvents++; continue }
      if (seen.has(id)) { duplicateEvents++; continue }
      seen.add(id)
      for (const target of [group, total]) {
        target.responses++; target.input += u.input_tokens; target.cachedInput += u.cached_input_tokens
        target.uncachedInput += u.input_tokens - u.cached_input_tokens; target.output += u.output_tokens
        target.reasoningSubset += u.reasoning_output_tokens
      }
    }
  }
  return { from: input.from, to: input.to, groups, total, duplicateEvents, invalidEvents,
    note: 'Measured per-response tokens for explicitly listed sessions. Cached input and reasoning are subsets. This is not a weekly-quota conversion or an invoice.' }
}

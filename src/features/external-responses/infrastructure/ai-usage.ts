import { createHash, randomUUID } from 'node:crypto'

type Attempt = {
  id: string; callId: string; operation: string; model: string; kind: 'inference' | 'file'
  at: string; durationMs?: number; status: 'pending' | 'http_result' | 'network_error'; httpStatus?: number
  requestHash: string | null; requestBytes: number | null
  inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null
}
const label = (value: string) => value.replace(/[^a-zA-Z0-9_.:/-]/g, '_').slice(0, 120)
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

/** Measurement only: never changes prompts, retries, model choice, answers or submission state. */
export function createAiUsageRecorder(writeLine?: (line: string) => void) {
  const attempts = new Map<string, Attempt>()
  let diagnosticFailures = 0
  const emit = (event: string, attempt: Attempt) => {
    try { writeLine?.(JSON.stringify({ schemaVersion: 1, event, ...attempt })) }
    catch { diagnosticFailures++ }
  }
  function track(fetchImpl: typeof fetch, operation: string, model: string, kind: Attempt['kind']): typeof fetch {
    const callId = randomUUID()
    return async (url, init) => {
      const body = typeof init?.body === 'string' ? init.body : undefined
      const started = Date.now()
      const row: Attempt = { id: randomUUID(), callId, operation: label(operation), model: label(model), kind,
        at: new Date(started).toISOString(), status: 'pending', requestHash: body === undefined ? null : createHash('sha256').update(body).digest('hex'),
        requestBytes: body === undefined ? null : Buffer.byteLength(body), inputTokens: null, outputTokens: null, cachedInputTokens: null }
      attempts.set(row.id, row); emit('ai.request_started', row)
      let response: Response
      try { response = await fetchImpl(url, init) }
      catch (error) {
        row.status = 'network_error'; row.durationMs = Date.now() - started
        emit('ai.request_finished', row); throw error
      }
      row.status = 'http_result'; row.httpStatus = response.status
      // Clone preserves the original transport response. No prompts, headers, filenames or response text are logged.
      try {
        if (kind === 'inference') {
          const payload = await response.clone().json(), usage = payload?.usage
          row.inputTokens = count(usage?.input_tokens); row.outputTokens = count(usage?.output_tokens)
          const cached = count(usage?.input_tokens_details?.cached_tokens)
          row.cachedInputTokens = cached !== null && row.inputTokens !== null && cached <= row.inputTokens ? cached : null
        }
      } catch { /* A malformed/unavailable usage response stays unknown; never retry for metrics. */ }
      row.durationMs = Date.now() - started; emit('ai.request_finished', row)
      return response
    }
  }
  function report() {
    const rows = [...attempts.values()]
    const summarize = (items: Attempt[]) => {
      const calls = new Set(items.map(row => row.callId)), inference = items.filter(row => row.kind === 'inference')
      const hashes = new Map<string, Set<string>>()
      for (const row of inference) if (row.requestHash) {
        const key = `${row.model}:${row.operation}:${row.requestHash}`, ids = hashes.get(key) ?? new Set<string>()
        ids.add(row.callId); hashes.set(key, ids)
      }
      return { logicalCalls: calls.size, httpAttempts: items.length, retryAttempts: items.length - calls.size,
        inferenceAttempts: inference.length, pendingAttempts: items.filter(row => row.status === 'pending').length,
        failedHttpOrNetworkAttempts: items.filter(row => row.status === 'network_error' || (row.httpStatus ?? 0) >= 400).length,
        unknownUsageAttempts: inference.filter(row => row.inputTokens === null || row.outputTokens === null).length,
        knownInputTokens: inference.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
        knownOutputTokens: inference.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
        knownCachedInputTokens: inference.reduce((sum, row) => sum + (row.cachedInputTokens ?? 0), 0),
        requestBytes: items.reduce((sum, row) => sum + (row.requestBytes ?? 0), 0),
        repeatedLogicalInputs: [...hashes.values()].reduce((sum, ids) => sum + Math.max(0, ids.size - 1), 0) }
    }
    const groups = new Map<string, Attempt[]>()
    for (const row of rows) { const key = `${row.model}\0${row.operation}`; const items = groups.get(key) ?? []; items.push(row); groups.set(key, items) }
    const byOperation = [...groups.values()].map(items => ({ model: items[0].model, operation: items[0].operation, ...summarize(items) }))
      .sort((a, b) => (b.knownInputTokens + b.knownOutputTokens) - (a.knownInputTokens + a.knownOutputTokens))
    return { schemaVersion: 1, ...summarize(rows), byOperation, diagnosticFailures,
      notes: ['Known token totals exclude unknown usage; cached input is part of input, not additional tokens.',
        'Repeated inputs include failures and are reuse candidates, not proven avoidable cost.',
        'Request bytes are not token estimates. External tailoring usage is not observed by this AI transport.'],
      cost: null }
  }
  return { track, report }
}
export type AiUsageRecorder = ReturnType<typeof createAiUsageRecorder>

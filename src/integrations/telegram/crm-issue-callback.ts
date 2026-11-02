/** Forward CRM capabilities inside the existing support-bot polling owner. */
type CrmCallbackOutcome = { handled: boolean; outcome?: string }
type CrmCallbackBot = { answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<unknown> }
type CrmCallbackOptions = {
  enabled?: boolean
  endpoint?: string
  secret?: string
  requester?: typeof fetch
  timeoutMs?: number
}

const CRM_CALLBACK_UNAVAILABLE = 'Не удалось проверить кнопку. Повторите нажатие позже или напишите команде в этом чате.'

async function readBoundedCrmReply(response: Response, maximumBytes = 4096): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('crm_callback_unavailable')
  const declared = response.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    await response.body.cancel().catch(() => undefined)
    throw new Error('crm_callback_response_too_large')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > maximumBytes) throw new Error('crm_callback_response_too_large')
      chunks.push(result.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function createCrmIssueCallbackForwarder(options: CrmCallbackOptions = {}) {
  const enabled = options.enabled ?? /^(1|true)$/i.test(String(process.env.CRM_ISSUE_CALLBACK_ENABLED ?? '').trim())
  const endpoint = options.endpoint ?? String(process.env.CRM_ISSUE_CALLBACK_URL ?? '').trim()
  const secret = options.secret ?? String(process.env.CRM_ISSUE_CALLBACK_SECRET ?? '').trim()
  const requester = options.requester ?? fetch
  const timeoutMs = options.timeoutMs ?? 5000
  if (typeof enabled !== 'boolean' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new Error('crm_callback_configuration_invalid')
  }
  if (enabled) {
    let url: URL
    try { url = new URL(endpoint) } catch { throw new Error('crm_callback_configuration_invalid') }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/integrations/telegram/account-issues/' || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
      throw new Error('crm_callback_configuration_invalid')
    }
  }
  return async function forwardCrmIssueCallback(update: any, botApi: CrmCallbackBot): Promise<CrmCallbackOutcome> {
    const query = update?.callback_query
    if (typeof query?.data !== 'string' || !query.data.startsWith('ci:')) return { handled: false }
    if (typeof query.id !== 'string' || !query.id.length || query.id.length > 256) {
      return { handled: true, outcome: 'input_invalid' }
    }
    let text = CRM_CALLBACK_UNAVAILABLE
    let outcome = enabled ? 'unavailable' : 'disabled'
    if (enabled) {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const body = JSON.stringify(update)
        if (Buffer.byteLength(body, 'utf8') > 16384) throw new Error('crm_callback_request_too_large')
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('crm_callback_deadline')) }, timeoutMs)
        })
        const request = async () => {
          const response = await requester(endpoint, {
            method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body
          })
          return readBoundedCrmReply(response) as Promise<any>
        }
        const reply = await Promise.race([request(), deadline])
        if (reply?.method !== 'answerCallbackQuery' || reply.callback_query_id !== query.id ||
            typeof reply.text !== 'string' || reply.text.length > 200) throw new Error('crm_callback_reply_invalid')
        text = reply.text
        outcome = 'crm_answer_received'
      } catch {
        // Never log exception/body/nonce/URL/secret or retry an uncertain mutation.
        controller.abort()
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    try {
      await botApi.answerCallbackQuery({ callbackQueryId: query.id, text })
      return { handled: true, outcome }
    } catch {
      // Do not fall into the generic resume catch that sends another chat message.
      return { handled: true, outcome: 'callback_answer_unconfirmed' }
    }
  }
}

module.exports = { createCrmIssueCallbackForwarder, readBoundedCrmReply, CRM_CALLBACK_UNAVAILABLE }

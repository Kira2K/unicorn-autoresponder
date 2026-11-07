// Recognition has no browser access. The caller supplies the existing OCR or
// reviewed-text adapter; no provider, credentials or paid service is hardcoded.
type CaptchaContext = { signal: AbortSignal; timeoutMs: number }
type CaptchaImage = { id: string; bytes: Buffer }
type CaptchaAdapters = {
  now?(): number
  sleep?(ms: number): Promise<void>
  present(): Promise<boolean>
  english(context: CaptchaContext): Promise<unknown>
  capture(context: CaptchaContext): Promise<CaptchaImage>
  save(image: CaptchaImage, attempt: number): Promise<unknown>
  recognize(bytes: Buffer, context: CaptchaContext & { artifact: unknown; attempt: number }): Promise<string>
  fill(text: string, context: CaptchaContext): Promise<unknown>
  submit(context: CaptchaContext): Promise<unknown>
}
async function solveCaptcha(adapters: CaptchaAdapters, options: { maxAttempts?: number; timeoutMs?: number } = {}) {
  const now = adapters.now ?? Date.now
  const sleep = adapters.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)))
  const end = now() + (options.timeoutMs ?? 60000)
  const maxAttempts = options.maxAttempts ?? 3
  const controller = new AbortController()
  let attempts = 0
  let submitted = false
  const context = () => ({ signal: controller.signal, timeoutMs: Math.max(1, end - now()) })
  async function bounded<T>(run: () => Promise<T>): Promise<T> {
    if (now() >= end) throw new Error('captcha_timeout')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([run(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('captcha_timeout')) }, end - now())
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
  try {
    if (!await bounded(() => adapters.present())) return { solved: true, attempts }
    await bounded(() => adapters.english(context()))
    while (attempts < maxAttempts && now() < end) {
      if (!await bounded(() => adapters.present())) return { solved: true, attempts }
      attempts++
      const image = await bounded(() => adapters.capture(context()))
      const artifact = await bounded(() => adapters.save(image, attempts))
      const answer = String(await bounded(() => adapters.recognize(image.bytes, { ...context(), artifact, attempt: attempts })) ?? '').trim()
      if (!answer || answer.length > 100 || /[\r\n\u0000]/.test(answer)) continue
      if ((await bounded(() => adapters.capture(context()))).id !== image.id) continue
      await bounded(() => adapters.fill(answer, context()))
      // Filling can also race with challenge expiry. Never submit stale text.
      if ((await bounded(() => adapters.capture(context()))).id !== image.id) continue
      submitted = true
      await bounded(() => adapters.submit(context()))
      const decisionEnd = Math.min(end, now() + 3000)
      while (now() < decisionEnd) {
        if (!await bounded(() => adapters.present())) return { solved: true, attempts }
        if ((await bounded(() => adapters.capture(context()))).id !== image.id) break
        await sleep(Math.min(200, decisionEnd - now()))
      }
    }
    return { solved: !await bounded(() => adapters.present()), attempts, reason: 'captcha_attempt_limit' }
  } catch (error: any) {
    if (submitted && error.message !== 'captcha_timeout' && !controller.signal.aborted) {
      try {
        if (!await bounded(() => adapters.present())) return { solved: true, attempts }
      } catch { /* A closed browser is not proof that the answer was accepted. */ }
    }
    return { solved: false, attempts, reason: error.message === 'captcha_timeout' ? 'captcha_timeout' : 'captcha_adapter_error' }
  } finally { controller.abort() }
}
module.exports = { solveCaptcha }

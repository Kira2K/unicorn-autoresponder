type CaptchaFrame = {
  getAttribute(name: string): Promise<string | null>
  isVisible(): Promise<boolean>
  boundingBox(): Promise<{ width: number; height: number } | null>
  contentFrame?(): { locator(selector: string): { innerText(options?: { timeout: number }): Promise<string> } }
}
type CaptchaPage = { url(): string; locator(selector: string): { all(): Promise<CaptchaFrame[]> }; frames?(): { url(): string; locator(selector: string): { innerText(options?: { timeout: number }): Promise<string>; getAttribute(name: string, options?: { timeout: number }): Promise<string | null> } }[] }

const puzzle = /select (?:all|each)|click (?:all|each)|choose (?:all|each)|solve the challenge|verify (?:that )?you are human|drag (?:the |a |an )?(?:letter|piece|object|shape|item) (?:to|into|onto) (?:the )?(?:place|spot|target|location)/i
export const puzzleInstruction = (text: string) => puzzle.test(text)

/** A checked provider control is evidence of completed verification, without reading its token. */
export async function captchaVerificationComplete(page: CaptchaPage): Promise<boolean> {
  for (const frame of page.frames?.() ?? []) {
    let url: URL
    try { url = new URL(frame.url()) } catch { continue }
    if (!/(^|\.)(hcaptcha\.com|google\.com|recaptcha\.net)$/.test(url.hostname)) continue
    for (const selector of ['[role="checkbox"]', 'input[type="checkbox"]']) {
      const checked = await frame.locator(selector).getAttribute('aria-checked', { timeout: 300 }).catch(() => null)
      if (checked === 'true') return true
    }
  }
  return false
}

/** Detect active visual puzzles, not background widgets. Never read verification tokens. */
export async function visibleCaptchaChallenge(page: CaptchaPage): Promise<boolean> {
  for (const frame of await page.locator('iframe').all()) {
    const src = await frame.getAttribute('src') ?? ''
    let url: URL
    try { url = new URL(src, page.url()) } catch { continue }
    const title = await frame.getAttribute('title') ?? ''
    const enclave = /(?:[?#&])frame=enclave(?:[&#]|$)/i.test(src) || /\/hcaptcha-enclave\.html$/i.test(url.pathname)
    const hcaptcha = /(^|\.)hcaptcha\.com$/.test(url.hostname)
      && ((/challenge/i.test(title) && !/checkbox/i.test(title))
        || /(?:[?#&])(?:frame=challenge|id=challenge)/i.test(src)
        || /main content of the hcaptcha challenge/i.test(title))
    const recaptcha = /(^|\.)(google\.com|recaptcha\.net)$/.test(url.hostname)
      && /\/recaptcha\/.*bframe/.test(url.pathname)
    if (!(hcaptcha || recaptcha || enclave && /(^|\.)hcaptcha\.com$/.test(url.hostname)) || !await frame.isVisible().catch(() => false)) continue
    const box = await frame.boundingBox().catch(() => null)
    if (!box || box.width <= 150 || box.height <= 150) continue
    if (hcaptcha || recaptcha) return true
    // The large enclave is also used as a passive widget. Require puzzle UI inside it.
    const matching = (page.frames?.() ?? []).find(f => f.url() === url.href)
    let text = await matching?.locator('body').innerText({ timeout: 300 }).catch(() => '') ?? ''
    if (!text) text = await frame.contentFrame?.().locator('body').innerText({ timeout: 300 }).catch(() => '') ?? ''
    if (puzzle.test(text)) return true
  }
  return false
}

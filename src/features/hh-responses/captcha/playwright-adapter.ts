const { createHash } = require('node:crypto')

// English-selection order recovered from hh-captha-solver, commit 61ee360f.
// HH may keep Russian modal labels while changing only the challenge image.
async function switchCaptchaToEnglish(page: any) {
  const language = page.locator('[data-qa="captcha-language"]')
  if (await language.isVisible().catch(() => false)) {
    const current = (await language.innerText()).trim()
    // This button names the TARGET language. Wait for the replacement image;
    // a screenshot taken immediately after the click can still contain Russian.
    if (/русск/i.test(current)) return false
    if (/english|^en$|^eng$/i.test(current)) { await language.click({timeout:3000}); return true }
  }
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"], [role="link"], input[type="button"], span')]
      .filter(element => { const r = element.getBoundingClientRect(); return r.width && r.height })
    const text = (element: Element) => (element.textContent || element.getAttribute('aria-label') || element.getAttribute('value') || '').trim()
    const target = candidates.find(element => /^(english|en|eng|на английском|английский)$/i.test(text(element))) ??
      candidates.find(element => text(element).length < 80 && /\benglish\b|\ben\b|англ/i.test(text(element)))
    if (target) (target as HTMLElement).click()
    return Boolean(target)
  })
}

function createPlaywrightCaptchaAdapters(page: any, dependencies: {
  recognize(bytes: Buffer, context: any): Promise<string>
  save(image: { id: string; bytes: Buffer }, attempt: number): Promise<unknown>
}) {
  const input = () => page.locator('input[name*="captcha" i]:visible, input[data-qa*="captcha" i]:visible, input[placeholder*="картинки"]:visible').first()
  const picture = () => page.locator('img[src*="captcha" i]:visible, [data-qa*="captcha" i] img:visible, canvas[data-qa*="captcha" i]:visible').first()
  return {
    present: async () => input().isVisible(),
    english: async () => {
      const before = await picture().getAttribute('src').catch(() => null)
      if (await switchCaptchaToEnglish(page)) {
        const end = Date.now() + 5000
        while (Date.now() < end) {
          await page.waitForTimeout(200)
          const current = await picture().getAttribute('src').catch(() => null)
          const ready = await picture().evaluate((element: any) => !('complete' in element) || element.complete).catch(() => false)
          if (current !== before && ready) break
        }
      }
    },
    capture: async ({timeoutMs}: any = {}) => {
      const bytes = await picture().screenshot({ timeout: Math.min(timeoutMs ?? 5000, 5000) })
      return { id: createHash('sha256').update(bytes).digest('hex'), bytes }
    },
    save: dependencies.save,
    recognize: dependencies.recognize,
    fill: async (answer: string, {timeoutMs}: any) => input().fill(answer, { timeout: Math.min(timeoutMs, 5000) }),
    submit: async ({timeoutMs}: any) => {
      const field = input()
      const dialog = field.locator('xpath=ancestor::*[@role="dialog"][1]')
      const scope = await dialog.count() ? dialog : field.locator('xpath=ancestor::form[1]')
      if (!await scope.count()) throw new Error('captcha_submit_container_missing')
      await scope.getByRole('button', { name: /^(отправить|продолжить|submit|continue|войти)$/i }).first()
        .click({ timeout: Math.min(timeoutMs, 5000) })
    }
  }
}
module.exports = { createPlaywrightCaptchaAdapters, switchCaptchaToEnglish }

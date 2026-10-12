import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchFixtureBrowser } from './browser-driver.ts'
import { visibleCaptchaChallenge } from '../applications/captcha.ts'

test('visible CAPTCHA detection excludes hidden widgets and unrelated frames', async () => {
  const browser = await launchFixtureBrowser()
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '' }))
    await page.goto('https://fixture.test')
    for (const [src, title, visible, width, height, expected] of [
      ['https://newassets.hcaptcha.com/captcha.html#frame=challenge', '', true, 400, 500, true],
      ['https://newassets.hcaptcha.com/captcha.html', 'Main content of the hCaptcha challenge', true, 400, 500, true],
      ['https://newassets.hcaptcha.com/captcha.html#frame=challenge', '', false, 400, 500, false],
      ['https://newassets.hcaptcha.com/captcha.html#frame=checkbox', 'Widget containing checkbox for hCaptcha security challenge', true, 400, 500, false],
      ['https://newassets.hcaptcha.com/captcha.html#frame=enclave', 'Widget containing checkbox for hCaptcha security challenge', true, 400, 500, false],
      ['https://newassets.hcaptcha.com/captcha.html#frame=enclave', 'Widget containing checkbox for hCaptcha security challenge', true, 80, 80, false],
      ['https://newassets.hcaptcha.com/captcha.html#frame=enclave', 'Widget containing checkbox for hCaptcha security challenge', false, 400, 500, false],
      ['https://www.google.com/recaptcha/api2/bframe', '', true, 400, 500, true],
      ['https://www.google.com/recaptcha/api2/anchor', '', true, 400, 500, false],
      ['https://unrelated.test/frame', 'challenge', true, 400, 500, false],
    ] as const) {
      await page.setContent(`<iframe style="width:${width}px;height:${height}px;${visible ? '' : 'display:none'}" src="${src}" title="${title}"></iframe>`)
      assert.equal(await visibleCaptchaChallenge(page), expected, src)
    }
  } finally { await browser.close() }
})

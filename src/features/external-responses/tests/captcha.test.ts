import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleCaptchaChallenge } from '../applications/captcha.ts'

test('passive hCaptcha enclave is not a proven challenge', async () => {
  for (const [src, title, visible, width, height, expected] of [
    ['https://newassets.hcaptcha.com/captcha.html#frame=enclave', 'Widget containing checkbox for hCaptcha security challenge', true, 400, 500, false],
    ['https://newassets.hcaptcha.com/captcha.html#frame=enclave', 'Widget containing checkbox for hCaptcha security challenge', true, 80, 80, false],
    ['https://newassets.hcaptcha.com/captcha.html#frame=enclave', 'Widget containing checkbox for hCaptcha security challenge', false, 400, 500, false],
    ['https://newassets.hcaptcha.com/captcha.html#frame=checkbox', 'Widget containing checkbox for hCaptcha security challenge', true, 400, 500, false],
    ['https://unrelated.test/captcha.html#frame=enclave', 'Widget containing checkbox for hCaptcha security challenge', true, 400, 500, false],
  ] as const) {
    const frame = {
      getAttribute: async (name: string) => name === 'src' ? src : name === 'title' ? title : null,
      isVisible: async () => visible,
      boundingBox: async () => ({ width, height }),
    }
    const page = { url: () => 'https://fixture.test', locator: () => ({ all: async () => [frame] }) }
    assert.equal(await visibleCaptchaChallenge(page), expected, src)
  }
})

test('visible hCaptcha enclave drag-letter instruction is an active puzzle', async () => {
  const src = 'https://newassets.hcaptcha.com/captcha.html#frame=enclave'
  for (const [text, visible, width, expected] of [
    ['Drag the letter to the place where it fits', true, 400, true],
    ['Drag the letter to the place where it fits', false, 400, false],
    ['Drag the letter to the place where it fits', true, 80, false],
    ['Widget containing checkbox for hCaptcha security challenge', true, 400, false],
  ] as const) {
    const frame = { getAttribute: async (name: string) => name === 'src' ? src : name === 'title' ? 'Widget containing checkbox for hCaptcha security challenge' : null,
      isVisible: async () => visible, boundingBox: async () => ({ width, height: 500 }) }
    const page = { url: () => 'https://jobs.example/apply', locator: () => ({ all: async () => [frame] }),
      frames: () => [{ url: () => src, locator: () => ({ innerText: async () => text, getAttribute: async () => null }) }] }
    assert.equal(await visibleCaptchaChallenge(page), expected, text)
  }
})

test('visible hcaptcha-enclave source detects drag puzzle when runtime frame URL is blank', async () => {
  const src = 'https://newassets.hcaptcha.com/captcha/v1/hcaptcha-enclave.html'
  for (const [text, expected] of [
    ['Drag the letter to the place where it fits', true],
    ['Widget containing checkbox for hCaptcha security challenge', false],
  ] as const) {
    const frame = { getAttribute: async (name: string) => name === 'src' ? src : name === 'title' ? 'Widget containing checkbox for hCaptcha security challenge' : null,
      isVisible: async () => true, boundingBox: async () => ({ width: 1920, height: 961 }),
      contentFrame: () => ({ locator: () => ({ innerText: async () => text }) }) }
    const page = { url: () => 'https://jobs.example/apply', locator: () => ({ all: async () => [frame] }), frames: () => [{ url: () => '', locator: () => ({ innerText: async () => '', getAttribute: async () => null }) }] }
    assert.equal(await visibleCaptchaChallenge(page), expected, text)
  }
})

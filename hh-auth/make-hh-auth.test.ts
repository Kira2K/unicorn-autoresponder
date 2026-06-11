const assert = require('node:assert/strict')

const {
  waitForAuthAfterSubmit
} = require('./make-hh-auth.ts') as {
  waitForAuthAfterSubmit(page: any, options: any): Promise<any>
}

function makeCaptchaPage() {
  let waitForTimeoutCount = 0
  let captchaProbeCount = 0

  return {
    get waitForTimeoutCount() {
      return waitForTimeoutCount
    },
    get captchaProbeCount() {
      return captchaProbeCount
    },
    url: () => 'https://hh.ru/account/login',
    title: async () => 'HH',
    goto: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => {
      waitForTimeoutCount += 1
    },
    evaluate: async () => {
      captchaProbeCount += 1

      return true
    }
  }
}

async function testPostSubmitCaptchaReturnsImmediately(): Promise<void> {
  const page = makeCaptchaPage()
  const result = await waitForAuthAfterSubmit(page, { timeoutMs: 50 })

  assert.equal(result.state, 'captcha')
  assert.equal(page.waitForTimeoutCount, 1)
  assert.equal(page.captchaProbeCount, 2)
}

async function main(): Promise<void> {
  await testPostSubmitCaptchaReturnsImmediately()

  console.log('hh auth login tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})

const assert = require('node:assert/strict')
const { validateAuth } = require('./validate-auth.ts')

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
  // Login links may contain /applicant/resumes in their backUrl. They are not
  // proof of an authenticated session, even when navigation selectors match.
  const page = {
    url: () => 'https://hh.ru/account/login?backUrl=/applicant/resumes',
    title: async () => 'Login',
    evaluate: async () => false,
    locator: (selector: string) => ({ first: () => ({
      waitFor: async () => {
        if (!selector.includes('/applicant/resumes')) throw new Error('absent')
      },
      count: async () => 1
    }) })
  }
  const login = await validateAuth(page)
  assert.equal(login.signals.applicantResumesLink, true)
  assert.equal(login.state, 'logged_out')
  const authenticated = await validateAuth({ ...page, url: () => 'https://hh.ru/applicant/resumes' })
  assert.equal(authenticated.state, 'logged_in')
  const embeddedLogin = await validateAuth({
    ...page,
    url: () => 'https://hh.ru/applicant/resumes',
    locator: (selector: string) => ({ first: () => ({
      waitFor: async () => {
        if (!/applicant\/resumes|account\/login|input\[type="email"\]/.test(selector)) throw new Error('absent')
      },
      count: async () => 1
    }) })
  })
  assert.equal(embeddedLogin.state, 'logged_out')
  await testPostSubmitCaptchaReturnsImmediately()

  console.log('hh auth login tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyObservedOutcome, mayContinueAfterCaptcha } from '../applications/ats-forms.ts'
import { captchaVerificationComplete, visibleCaptchaChallenge } from '../applications/captcha.ts'

const attempt = { submitClicked: true, challengeSeen: true, applicationRequests: 0, applicationRequestFailed: false }

test('an automatic employer receipt after CAPTCHA counts as captured success', () => {
  const result = classifyObservedOutcome('Thank you for applying', 'https://jobs.lever.co/fixture/thanks', ['captchaToken is required'])
  assert.equal(result.status, 'succeeded')
  assert.equal(result.evidence?.confirmation, 'captured')
})

test('continuation requires verified provider control and no application write', () => {
  assert.equal(mayContinueAfterCaptcha(attempt, true, false), true)
  assert.equal(mayContinueAfterCaptcha(attempt, true, true), false, 'repeated challenge')
  assert.equal(mayContinueAfterCaptcha(attempt, false, false), false, 'challenge disappeared without proof')
  assert.equal(mayContinueAfterCaptcha({ ...attempt, applicationRequests: 1 }, true, false), false, 'request already sent')
  assert.equal(mayContinueAfterCaptcha({ ...attempt, applicationRequestFailed: true }, true, false), false, 'network loss after request')
  assert.equal(mayContinueAfterCaptcha({ ...attempt, challengeSeen: false }, true, false), false, 'passive widget alone')
  assert.equal(mayContinueAfterCaptcha({ ...attempt, navigationChanged: true }, true, false), false, 'page navigation loses same-form proof')
  assert.equal(mayContinueAfterCaptcha({ ...attempt, continuationClicked: true }, true, false), false, 'one continuation even without a network write')
})

test('opaque enclave needs puzzle text, while a checked provider control signals completion', async () => {
  let puzzleText = ''
  const frame = {
    getAttribute: async (name: string) => name === 'src' ? 'https://newassets.hcaptcha.com/captcha.html#frame=enclave' : name === 'title' ? 'Widget containing checkbox for hCaptcha security challenge' : null,
    isVisible: async () => true,
    boundingBox: async () => ({ width: 400, height: 500 })
  }
  let checked = 'false'
  const page = {
    url: () => 'https://jobs.lever.co/fixture/apply',
    locator: () => ({ all: async () => [frame] }),
    frames: () => [{ url: () => 'https://newassets.hcaptcha.com/captcha.html#frame=enclave', locator: (selector: string) => ({
      innerText: async () => selector === 'body' ? puzzleText : '',
      getAttribute: async (name: string) => selector === '[role="checkbox"]' && name === 'aria-checked' ? checked : null
    }) }]
  }
  assert.equal(await visibleCaptchaChallenge(page), false)
  puzzleText = 'Select all images with bicycles'
  assert.equal(await visibleCaptchaChallenge(page), true)
  puzzleText = ''
  checked = 'true'
  assert.equal(await captchaVerificationComplete(page), true)
  assert.equal(await visibleCaptchaChallenge(page), false)
})

test('disappearing challenge and failed network response remain unconfirmed', () => {
  assert.equal(classifyObservedOutcome('Submit Application', 'https://jobs.lever.co/fixture/apply', []).status, 'unknown')
  assert.equal(classifyObservedOutcome('Submit Application', 'https://jobs.lever.co/fixture/apply', ['HTTP 503']).status, 'unknown')
})

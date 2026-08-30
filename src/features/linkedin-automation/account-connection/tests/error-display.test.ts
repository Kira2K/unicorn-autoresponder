const assert = require('node:assert/strict')
const { linkedinAuthErrorDisplay } = require('../error-display.ts') as {
  linkedinAuthErrorDisplay(code: unknown): any
}
const { linkedInNocoError } = require('../noco-error.ts') as {
  linkedInNocoError(error: unknown): any
}

async function run(): Promise<void> {
  const cases = [
    ['linkedin_url_missing', 'Settings'],
    ['dolphin_proxy_unhealthy', 'Proxy'],
    ['dolphin_profile_in_use', 'Dolphin'],
    ['dolphin_local_api_unavailable', 'Dolphin'],
    ['dolphin_local_session_invalid', 'Dolphin'],
    ['linkedin_li_at_missing', 'LinkedIn session'],
    ['linkedin_profile_mismatch', 'Owner mismatch'],
    ['unipile_timeout', 'Unipile'],
    ['unipile_checkpoint_2fa', 'Checkpoint'],
    ['unknown_secret_error', 'Internal error']
  ]
  for (const [code, category] of cases) {
    const display = linkedinAuthErrorDisplay(code)
    assert.equal(display.category, category)
    assert.equal(display.code, code === 'unknown_secret_error' ? 'linkedin_auth_internal_error' : code)
  }
  assert.equal(linkedinAuthErrorDisplay(''), undefined)
  assert.equal(linkedInNocoError({ response: { status: 429 } }).code, 'noco_rate_limited')
}

module.exports = { run }

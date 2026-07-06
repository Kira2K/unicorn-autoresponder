require('dotenv').config()

const {
  checkGmailAuthorization,
  createGmailOAuthUrl,
  exchangeGmailOAuthCode,
  DEFAULT_OAUTH_REDIRECT_URI
} = require('./dolphin-verification-code.ts') as {
  checkGmailAuthorization(): Promise<{ ok: true; emailAddress?: string }>
  createGmailOAuthUrl(): string
  exchangeGmailOAuthCode(code: string): Promise<{ refresh_token?: string }>
  DEFAULT_OAUTH_REDIRECT_URI: string
}

function argValue(name: string): string {
  const prefix = `${name}=`
  const fromEquals = process.argv.find(arg => arg.startsWith(prefix))
  if (fromEquals) return fromEquals.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] ?? '') : ''
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    const result = await checkGmailAuthorization()
    console.log(`Gmail OAuth token is valid for ${result.emailAddress || 'the configured mailbox'}.`)
    return
  }

  const code = argValue('--code').trim()
  if (!code) {
    console.log('Open this URL while logged into kind.cute.unicorn@gmail.com:')
    console.log(createGmailOAuthUrl())
    console.log('')
    console.log('For longer-lived refresh tokens, set the Google OAuth consent screen to Production before approving this URL.')
    console.log(`After approval, Google redirects to ${DEFAULT_OAUTH_REDIRECT_URI}.`)
    console.log('Copy the "code" query parameter from the browser URL and run:')
    console.log('npm run web:gmail:token -- --code=PASTE_CODE_HERE')
    console.log('')
    console.log('After updating Render/local env, validate it with:')
    console.log('npm run web:gmail:token -- --check')
    return
  }

  const tokens = await exchangeGmailOAuthCode(code)
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Re-run the URL step; the app uses prompt=consent.')
  }
  console.log('Add this to .env and Render secrets:')
  console.log(`DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`)
  console.log('')
  console.log('Then restart the backend/Render service and run:')
  console.log('npm run web:gmail:token -- --check')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

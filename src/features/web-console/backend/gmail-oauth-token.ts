require('dotenv').config()

const {
  createGmailOAuthUrl,
  exchangeGmailOAuthCode,
  DEFAULT_OAUTH_REDIRECT_URI
} = require('./dolphin-verification-code.ts') as {
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
  const code = argValue('--code').trim()
  if (!code) {
    console.log('Open this URL while logged into kind.cute.unicorn@gmail.com:')
    console.log(createGmailOAuthUrl())
    console.log('')
    console.log(`After approval, Google redirects to ${DEFAULT_OAUTH_REDIRECT_URI}.`)
    console.log('Copy the "code" query parameter from the browser URL and run:')
    console.log('npm run web:gmail:token -- --code=PASTE_CODE_HERE')
    return
  }

  const tokens = await exchangeGmailOAuthCode(code)
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Re-run the URL step; the app uses prompt=consent.')
  }
  console.log('Add this to .env and Render secrets:')
  console.log(`DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

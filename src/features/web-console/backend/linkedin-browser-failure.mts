import { linkedinBrowserErrorText } from '../../linkedin-automation/core/browser-error-display.mts'

/** Expected browser refusal, not a provider outage; never expose the original error text. */
export function linkedInBrowserFailure(error: unknown) {
  if ((error as { code?: unknown } | null)?.code !== 'linkedin_browser_unsupported') return undefined
  return { status: 409, body: { error: 'linkedin_browser_unsupported',
    message: linkedinBrowserErrorText('linkedin_browser_unsupported')! } }
}

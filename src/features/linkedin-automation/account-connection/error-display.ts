type ErrorTone = 'warning' | 'danger'
type ErrorDisplay = {
  code: string
  category: string
  message: string
  action: string
  tone: ErrorTone
}

const GROUPS = [
  {
    category: 'Settings',
    prefixes: ['noco_', 'linkedin_account_', 'linkedin_url_', 'dolphin_en_profile_'],
    message: 'Required LinkedIn or Dolphin configuration is incomplete.',
    action: 'Fix the account row and the En Dolphin profile.'
  },
  {
    category: 'Proxy',
    prefixes: ['dolphin_proxy_'],
    message: 'The Dolphin proxy is missing, invalid, or unavailable.',
    action: 'Check the proxy attached to the En Dolphin profile.'
  },
  {
    category: 'Dolphin',
    prefixes: ['dolphin_profile_', 'dolphin_cdp_', 'dolphin_context_'],
    message: 'Dolphin could not prepare the browser profile.',
    action: 'Close conflicting sessions and retry from the local console.'
  },
  {
    category: 'LinkedIn session',
    prefixes: ['linkedin_li_at_', 'linkedin_user_agent_'],
    message: 'The LinkedIn session in Dolphin is not ready.',
    action: 'Log in to LinkedIn in the En Dolphin profile and retry.'
  },
  {
    category: 'Owner mismatch',
    prefixes: ['linkedin_profile_mismatch', 'linkedin_provider_id_mismatch'],
    message: 'The opened LinkedIn profile does not match the saved owner.',
    action: 'Check the LinkedIn URL and the account logged in to Dolphin.'
  },
  {
    category: 'Unipile',
    prefixes: ['unipile_'],
    message: 'Unipile could not validate or connect the account.',
    action: 'Check the account status and retry after the service is available.'
  }
]

function linkedinAuthErrorDisplay(value: unknown): ErrorDisplay | undefined {
  const code = String(value ?? '').trim().toLowerCase()
  if (!code) return undefined
  if (code === 'dolphin_local_api_unavailable' || code === 'dolphin_local_session_invalid') {
    return {
      code, category: 'Dolphin', tone: 'warning',
      message: code.endsWith('session_invalid')
        ? 'Dolphin Local API session is invalid.'
        : 'Dolphin Local API is unavailable.',
      action: 'Fully restart Dolphin, log in, wait for Local API port 3001, and retry.'
    }
  }
  if (code.startsWith('unipile_checkpoint_')) {
    return {
      code, category: 'Checkpoint', tone: 'warning',
      message: 'LinkedIn requires a checkpoint or 2FA.',
      action: 'Open Dolphin, restore the LinkedIn session, and retry.'
    }
  }
  if (code === 'unipile_timeout' || code === 'unipile_unreachable') {
    return {
      code, category: 'Unipile', tone: 'danger',
      message: 'The Unipile API did not respond.',
      action: 'Check network access to api.unipile.com and retry.'
    }
  }
  const group = GROUPS.find(item => item.prefixes.some(prefix => code.startsWith(prefix)))
  if (group) return { code, tone: group.category === 'Unipile' ? 'danger' : 'warning', ...group }
  return {
    code: 'linkedin_auth_internal_error', category: 'Internal error', tone: 'danger',
    message: 'LinkedIn authentication failed unexpectedly.',
    action: 'Check the local JSONL log and retry.'
  }
}

module.exports = { linkedinAuthErrorDisplay }
export type { ErrorDisplay }

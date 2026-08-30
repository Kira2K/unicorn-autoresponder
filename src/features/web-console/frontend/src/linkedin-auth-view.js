export function primaryAction(account) {
  if (!account.unipileAccountId) return { action: 'connect', label: 'Connect' }
  if (account.unipileAccountStatus === 'running') return { action: 'connect', label: 'Verify owner' }
  return { action: 'connect', label: 'Reconnect' }
}

export function runForAccount(runs, account) {
  return runs[account.platformAccountId] || null
}

export function historyForAccounts(runs, accounts) {
  const ids = new Set(accounts.map(account => Number(account.platformAccountId)))
  return runs.filter(run => ids.has(Number(run.platformAccountId)))
}

export function failedRunAction(run, account) {
  if (run?.status !== 'failed' || !account) return null
  const code = String(run.errorCode || run.error?.code || '')
  if (['linkedin_url_invalid', 'linkedin_url_missing'].includes(code)) {
    return { action: 'edit_url', label: 'Fix URL' }
  }
  return account.unipileAccountId
    ? { action: 'force_reauth', label: 'Reconnect' }
    : { action: 'connect', label: 'Retry connect' }
}

export function confirmationMessage(account, action) {
  if (action === 'check') return ''
  if (action === 'connect' && account.unipileAccountId && account.unipileAccountStatus === 'running') {
    return `Unipile will verify the owner for ${account.clientName}. Dolphin will not be restarted while the account is running. Continue?`
  }
  return `Dolphin profile for ${account.clientName} will be restarted. Continue?`
}

export function statusView(account, run) {
  if (run?.status === 'running') {
    const stages = {
      pre_api_ready: 'Local session ready',
      unipile_authentication: 'Connecting to Unipile',
      unipile_accounts_listed: 'Finding existing Unipile account',
      unipile_existing_owner_checked: 'Checking existing account owner',
      unipile_reauthentication: 'Reconnecting existing Unipile account',
      unipile_account_read: 'Checking Unipile account',
      unipile_owner_profile_read: 'Verifying profile owner',
      noco_connection_saved: 'Saving connection'
    }
    return {
      tone: 'info',
      label: 'Running',
      stage: stages[run.stage] || run.stage.replaceAll('_', ' ')
    }
  }
  if (run?.status === 'failed') {
    return { tone: run.error?.tone || 'danger', label: run.error?.category || 'Error', error: run.error }
  }
  if (run?.status === 'succeeded') return { tone: 'success', label: 'Completed' }
  const tones = {
    connected: 'success', attention: 'warning', error: 'danger', not_connected: 'neutral'
  }
  const labels = {
    connected: 'Connected', attention: 'Needs attention', error: 'Error', not_connected: 'Not connected'
  }
  return {
    tone: tones[account.state] || 'neutral',
    label: labels[account.state] || 'Not connected',
    error: account.error
  }
}

export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

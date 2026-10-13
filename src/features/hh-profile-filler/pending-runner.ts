import { profileFillerError } from './errors.ts'

function manualOnly(): never {
  throw profileFillerError('profile_manual_only',
    'HH Profile Filler runs only on manual request with --client-id and --market; status scans, queues and scheduled runs are disabled.',
    'manual_only')
}

// Keep legacy entry points fail-closed without reading data, opening HH or sending reports.
export async function scanTransitions(_options: { statePath?: string; refresh?: boolean } = {}) {
  return manualOnly()
}

export async function runPending(_options: { statePath?: string; scanOnly?: boolean } = {}) {
  return manualOnly()
}

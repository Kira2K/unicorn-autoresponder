import { google } from 'googleapis'
import fs from 'node:fs'
import path from 'node:path'
import { profileFillerError } from './errors.ts'

type DriveClientConfig = {
  version: 'v3'
  auth: string | InstanceType<typeof google.auth.GoogleAuth>
}

// Choose authorization once. Request failures must never switch identities.
export function createProfileDriveClient(options: {
  env?: NodeJS.ProcessEnv
  cwd?: string
  createClient?: (config: DriveClientConfig) => any
} = {}) {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const mode = String(env.HH_PROFILE_DRIVE_AUTH ?? '').trim() || 'auto'
  if (!['auto', 'api-key', 'service-account'].includes(mode)) {
    throw profileFillerError('profile_drive_auth_invalid',
      'HH_PROFILE_DRIVE_AUTH must be auto, api-key or service-account.', 'load_sources')
  }
  const apiKey = String(env.GOOGLE_DRIVE_API_KEY ?? '').trim()
  if (mode === 'api-key' && !apiKey) {
    throw profileFillerError('profile_drive_api_key_missing',
      'GOOGLE_DRIVE_API_KEY is required for api-key authorization.', 'load_sources')
  }
  const createClient = options.createClient ?? (config => google.drive(config))
  if (mode !== 'service-account' && apiKey) {
    return createClient({ version: 'v3', auth: apiKey })
  }

  // Preserve the existing key-file discovery and Google Application Default Credentials.
  const credentialRoots = [cwd]
  if (env.DOTENV_CONFIG_PATH) {
    credentialRoots.push(path.dirname(path.resolve(cwd, env.DOTENV_CONFIG_PATH)))
  }
  const localCredentialCandidates = [...new Set(credentialRoots.flatMap(root =>
    fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true })
      .filter(item => item.isFile() && /^project-.*\.json$/i.test(item.name))
      .map(item => path.resolve(root, item.name)) : []))]
  const credentialsFile = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim() ||
    (localCredentialCandidates.length === 1 ? localCredentialCandidates[0] : undefined)
  return createClient({ version: 'v3', auth: new google.auth.GoogleAuth({
    keyFile: credentialsFile,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  }) })
}

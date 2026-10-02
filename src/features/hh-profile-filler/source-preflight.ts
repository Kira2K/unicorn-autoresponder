import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'
import { readPostgresAppDbConfig } from '../../platform/db/postgres/config.mts'
import { profileFillerError } from './errors.ts'
import type { SourceIdentity } from './types.ts'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export function verifySourceConfiguration(effective: Record<string, string | undefined>,
  authoritative: Record<string, string | undefined>): SourceIdentity {
  const fail = () => profileFillerError('profile_source_unverified',
    'Current PostgreSQL source does not match the main runtime configuration.', 'source_preflight')
  if (effective.APP_DB?.trim().toLowerCase() !== 'postgres' ||
      authoritative.APP_DB?.trim().toLowerCase() !== 'postgres') throw fail()
  const actual = readPostgresAppDbConfig(effective)
  const expected = readPostgresAppDbConfig(authoritative)
  if (actual.database === 'unicorn_noco_copy_restore' ||
      ['host', 'port', 'database', 'user'].some(key =>
        actual[key as keyof typeof actual] !== expected[key as keyof typeof expected])) throw fail()
  return { host: actual.host, port: actual.port, database: actual.database, readAt: new Date().toISOString() }
}

export function runtimeSourcePreflight(): SourceIdentity {
  // Do not let an inherited environment or a different cwd silently choose a snapshot.
  const file = path.join(runtimeRoot, '.env')
  if (!fs.existsSync(file)) throw profileFillerError('profile_source_unverified',
    'The main runtime source configuration is unavailable.', 'source_preflight')
  return verifySourceConfiguration(process.env, parse(fs.readFileSync(file)))
}

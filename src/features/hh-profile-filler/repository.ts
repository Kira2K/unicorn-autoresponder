import { createProfileFillerNocoRepository } from './noco-repository.ts'
import { createProfileFillerPostgresSource } from './postgres-source.mts'
import { loadRuntimePostgresReader, runtimePostgresSourceIdentity } from '../../platform/db/postgres/runtime.mts'
import { runtimeSourcePreflight } from './source-preflight.ts'
import { profileFillerError } from './errors.ts'
import type { ResolvedClient } from './types.ts'

// Select only the record transport. The existing repository keeps all selection and cache rules.
export function createProfileFillerRepository(mode = process.env.APP_DB, load = loadRuntimePostgresReader) {
  if (mode?.trim().toLowerCase() !== 'postgres') return createProfileFillerNocoRepository()
  const checkedLoad = async () => {
    const source = load === loadRuntimePostgresReader ? runtimeSourcePreflight() : undefined
    // The shared reader checks the connected database marker and schema in READ ONLY transactions.
    const reader = await load()
    const active = runtimePostgresSourceIdentity()
    if (source && (!active || source.host !== active.host || source.port !== active.port || source.database !== active.database)) {
      throw profileFillerError('profile_source_unverified',
        'The active PostgreSQL pool does not match the verified runtime source.', 'source_preflight')
    }
    return reader
  }
  const repository = createProfileFillerNocoRepository(createProfileFillerPostgresSource(checkedLoad))
  return {
    ...repository,
    async resolveClient(id: number, market: Parameters<typeof repository.resolveClient>[1]): Promise<ResolvedClient> {
      const sourceIdentity = load === loadRuntimePostgresReader ? runtimeSourcePreflight() : undefined
      const resolved = await repository.resolveClient(id, market)
      return sourceIdentity ? { ...resolved, sourceIdentity } : resolved
    }
  }
}

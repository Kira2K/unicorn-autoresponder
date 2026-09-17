import { createProfileFillerNocoRepository } from './noco-repository.ts'
import { createProfileFillerPostgresSource } from './postgres-source.mts'
import { loadRuntimePostgresReader } from '../../platform/db/postgres/runtime.mts'

// Select only the record transport. The existing repository keeps all selection and cache rules.
export function createProfileFillerRepository(mode = process.env.APP_DB, load = loadRuntimePostgresReader) {
  return mode?.trim().toLowerCase() === 'postgres'
    ? createProfileFillerNocoRepository(createProfileFillerPostgresSource(load))
    : createProfileFillerNocoRepository()
}

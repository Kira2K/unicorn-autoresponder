import type { AppDb } from '../types.ts';
import { createPostgresRecordSource } from './record-source.mts';
import { loadRuntimePostgresReader } from './runtime.mts';

// Other modes retain the readiness checker's existing Noco defaults, including Sheets mode.
export function hhReadinessOptions(mode: string | undefined, db: AppDb, load = loadRuntimePostgresReader) {
  return mode?.trim().toLowerCase() === 'postgres'
    ? { db, nocoClient: createPostgresRecordSource(load) }
    : {};
}

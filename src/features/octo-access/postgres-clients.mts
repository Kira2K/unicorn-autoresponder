import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
import type { SqlSession } from '../../integrations/postgres/contracts.mts';
import type { ClientState } from './onboarding-contracts.mts';

export function validateClient(input: ClientState) {
  if (!Number.isSafeInteger(input.clientId) || input.clientId < 1 ||
      !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      typeof input.password !== 'string' || !/^\d{5}$/.test(input.password) ||
      (input.nodeMavenKey !== undefined && typeof input.nodeMavenKey !== 'string'))
    throw new PostgresReadError('octo_invalid_state');
}
export function clientState(row: Record<string, unknown>): ClientState {
  if (!row.state || typeof row.state !== 'object' || Array.isArray(row.state))
    throw new PostgresReadError('octo_invalid_state');
  const state = structuredClone(row.state as ClientState);
  if (state.clientId !== Number(row.client_id) || state.revision !== Number(row.revision) || state.password !== row.password)
    throw new PostgresReadError('octo_invalid_state');
  validateClient(state);
  return state;
}
export async function claimClientPassword(s: SqlSession, clientId: number, candidate: string): Promise<ClientState> {
  validateClient({ clientId, password: candidate, revision: 1 });
  // Same lock as profile reservation, followed by a row lock: no external work in this transaction.
  await s.query('SELECT pg_advisory_xact_lock(730644, $1::integer)', [clientId]);
  const existing = (await s.query('SELECT client_id,password,revision,state FROM noco.octo_clients WHERE client_id=$1 FOR UPDATE', [clientId])).rows[0];
  if (existing) return clientState(existing);
  const state: ClientState = { clientId, password: candidate, revision: 1 };
  try {
    const result = await s.query(`INSERT INTO noco.octo_clients(client_id,password,revision,state)
      VALUES($1,$2,1,$3::jsonb) RETURNING client_id,password,revision,state`, [clientId, candidate, JSON.stringify(state)]);
    return clientState(result.rows[0]);
  } catch (error) {
    const e = error as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'octo_clients_password_unique')
      throw new PostgresReadError('octo_password_conflict');
    throw error;
  }
}
export async function saveClientState(s: SqlSession, input: ClientState): Promise<ClientState> {
  validateClient(input);
  const next = { ...structuredClone(input), revision: input.revision + 1 };
  const result = await s.query(`UPDATE noco.octo_clients SET revision=revision+1,state=$4::jsonb
    WHERE client_id=$1 AND revision=$2 AND password=$3 RETURNING client_id,password,revision,state`,
  [input.clientId, input.revision, input.password, JSON.stringify(next)]);
  if (result.rows.length !== 1) throw new PostgresReadError('octo_stale_revision');
  return clientState(result.rows[0]);
}

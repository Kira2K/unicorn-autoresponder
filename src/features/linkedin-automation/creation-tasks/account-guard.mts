import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { assertStudentEditable } from './student-task.mts';

/** Invoked inside generic console account mutations, not expert result transactions. */
export async function guardAccount(s: SqlSession, key?: readonly string[], input?: Readonly<Record<string, unknown>>) {
  const row = key ? (await s.query('SELECT clients_id,platforms_id FROM noco.platform_accounts WHERE id=$1', [key[0]])).rows[0] : input;
  if (!row?.clients_id) return;
  const platform = (await s.query('SELECT lower(name) AS name FROM noco.platforms WHERE id=$1', [row.platforms_id])).rows[0]?.name;
  if (!['linkedin','email_outlook'].includes(String(platform))) return;
  await s.query('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE', [row.clients_id]);
  await assertStudentEditable(s, Number(row.clients_id));
}

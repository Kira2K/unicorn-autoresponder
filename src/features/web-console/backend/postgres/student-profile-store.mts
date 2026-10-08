import { createReadSession } from '../../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../../integrations/postgres/working-session.mts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import type { CopyDatabase, SqlPool } from '../../../../integrations/postgres/contracts.mts';
import type { ClientProfilePatch } from '../types.ts';

const fields = [
  ['middleName', 'middle_name'], ['noHigherEducation', 'no_higher_education'],
  ['currentCompany', 'current_company'], ['previousCompanies', 'previous_companies']
] as const;
export function studentProfileStore(pool: SqlPool, database: CopyDatabase) {
  const read = createReadSession(pool, database);
  return {
    async checkSchema() {
      await read(async session => {
        await session.query(`SELECT middle_name, no_higher_education,
          current_company, previous_companies FROM noco.clients LIMIT 0`);
      });
    },
    async load(clientId: number) {
      return read(async session => {
        const { rows } = await session.query(`SELECT middle_name,no_higher_education,current_company,
          previous_companies FROM noco.clients WHERE id=$1`, [clientId]);
        const row = rows[0];
        if (!row) throw new PostgresReadError('record_not_found');
        return { middleName: String(row.middle_name ?? ''), noHigherEducation: row.no_higher_education === true,
          currentCompany: String(row.current_company ?? ''), previousCompanies: String(row.previous_companies ?? '') };
      });
    },
    async save(clientId: number, patch: ClientProfilePatch) {
      const assignments: string[] = [], values: unknown[] = [clientId];
      for (const [key, column] of fields) {
        if (!Object.hasOwn(patch, key) || patch[key] === undefined) continue;
        values.push(key === 'noHigherEducation' ? patch[key] === true : patch[key] || null);
        assignments.push(`${column}=$${values.length}`);
      }
      if (patch.noHigherEducation === true) assignments.push('education=NULL', 'education_entries=NULL');
      if (!assignments.length) return;
      // Only this SQL write is transactional. The established profile save remains separate.
      await writeTransaction(pool, database, async session => {
        const result = await session.query(`UPDATE noco.clients SET ${assignments.join(',')} WHERE id=$1 RETURNING id`, values);
        if (!result.rows.length) throw new PostgresReadError('record_not_found');
      });
    }
  };
}

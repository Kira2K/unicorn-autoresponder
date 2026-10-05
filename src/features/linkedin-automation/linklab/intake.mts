import type { CopyRecord, SqlSession } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { PostgresTransaction } from '../../../integrations/postgres/working-client.mts';
import type { ResumeWorkflowRecord } from '../../web-console/backend/types.ts';
import { linkLabBaseQuery } from './base-query.mts';

export interface LinkLabIntake {
  account(clientId: number, save: (tx: PostgresTransaction) => Promise<CopyRecord>): Promise<CopyRecord>;
  englishApproval(before: ResumeWorkflowRecord, patch: Record<string, unknown>): Promise<void>;
}
export type IntakeTransaction = <T>(run: (session: SqlSession, tx: PostgresTransaction) => Promise<T>) => Promise<T>;

/** SQL only. The caller owns transactions and permissions; no ENV or external sends. */
export function createLinkLabIntake(transaction: IntakeTransaction, cvTableId: string,
  lockCv: (sql: SqlSession, id: number) => Promise<unknown>): LinkLabIntake {
  return {
    account(clientId, save) {
      return transaction(async (sql, tx) => {
        await sql.query('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE', [clientId]);
        const saved = await save(tx);
        if (Number(saved.data.clients_id) !== clientId) throw Error('linklab_owner_mismatch');
        if (Number(saved.data.platforms_id) !== 16) return saved;
        const existing = await sql.query('SELECT client_id FROM noco.linklab WHERE client_id=$1', [clientId]);
        if (existing.rows.length) return saved; // Never reset a working account or re-send its handoff.
        await sql.query('SELECT id FROM noco.platform_accounts WHERE clients_id=$1 FOR UPDATE', [clientId]);
        const selected = (await sql.query(`SELECT * FROM (${linkLabBaseQuery}) chosen WHERE client_id=$1`, [clientId])).rows[0];
        if (!selected?.platform_account_id || selected.data_issue) return saved;
        await sql.query('INSERT INTO noco.linklab(client_id,platform_account_id) VALUES($1,$2)',
          [clientId, selected.platform_account_id]);
        await sql.query("UPDATE noco.linklab_changes SET handoff=true,source='cabinet' WHERE client_id=$1 AND version=1",
          [clientId]);
        return saved;
      });
    },
    englishApproval(before, patch) {
      return transaction(async (sql, tx) => {
        // Serialize this student's intake and approval, including approval before LinkLab exists.
        await sql.query('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE', [before.clientId]);
        await lockCv(sql, before.id);
        const current = await tx.getRecord(cvTableId, [String(before.id)]);
        if (!current || Number(current.data.clients_id) !== before.clientId
          || current.data.status !== 'English version in approve by student'
          || String(current.data.en_version_url ?? '').trim() !== before.enVersionUrl
          || String(current.data.workflow_trace ?? '').trim() !== before.workflowTrace
          || !before.enVersionUrl.trim() || patch.status !== 'Russian version in process') {
          throw new PostgresReadError('resume_workflow_stale_status');
        }
        await tx.patchRecord(cvTableId, current.key, patch);
        const approval = await sql.query(`INSERT INTO noco.linklab_cv_approvals(workflow_id,client_id,en_version_url)
          VALUES($1,$2,$3) ON CONFLICT(workflow_id) DO UPDATE SET
            en_version_url=EXCLUDED.en_version_url, approved_at=clock_timestamp()
          WHERE linklab_cv_approvals.client_id=EXCLUDED.client_id RETURNING workflow_id`,
          [before.id, before.clientId, before.enVersionUrl]);
        if (approval.rows.length !== 1) throw new PostgresReadError('linklab_cv_owner_conflict');
      });
    }
  };
}

import type { CopyDatabase, SqlPool } from '../../integrations/postgres/contracts.mts';
import { createReadSession } from '../../integrations/postgres/read-session.mts';
import { readClientMessageConfig } from './message-config.mts';

/** One read-only source for both backend and CLI. Never seeds or logs settings. */
export async function loadClientNotificationSettings(pool: SqlPool, database: CopyDatabase) {
  const rows = await createReadSession(pool, database)(async session => (await session.query(`
    SELECT instructions_url,hh_instructions_url,cabinet_url,cabinet_password,support_tag,support_chat_id
    FROM noco.client_notification_settings WHERE singleton=true`)).rows);
  if (rows.length !== 1) throw new Error('client_notification_settings_required');
  const row = rows[0];
  const supportChatId = typeof row.support_chat_id === 'string' ? row.support_chat_id.trim() : '';
  if (!/^-?[1-9]\d*$/.test(supportChatId))
    throw new Error('client_notification_settings_invalid:support_chat_id');
  return { supportChatId, messageConfig: readClientMessageConfig({
    instructionsUrl: row.instructions_url,
    hhInstructionsUrl: row.hh_instructions_url,
    cabinetUrl: row.cabinet_url,
    cabinetPassword: row.cabinet_password,
    supportTag: row.support_tag,
  }) };
}

import { createRequire } from 'node:module';
import type { CopyDatabase, SqlPool } from '../../../../integrations/postgres/contracts.mts';
import { createReadSession } from '../../../../integrations/postgres/read-session.mts';
const { findSecuredGroup } = createRequire(import.meta.url)('../../../../integrations/telegram/secured-group-info.ts') as
  import('../../../../integrations/telegram/secured-group-info.ts').SecuredGroupModule;

export function createSecuredGroupReader(pool: SqlPool, database: CopyDatabase) {
  const read = createReadSession(pool, database);
  return (username: string) => findSecuredGroup(username, tag => read(async session => {
    const result = await session.query(`SELECT client_name, secured_general_chat_id, secured_general_chat_invitation_link
      FROM noco.clients
      WHERE lower(regexp_replace(regexp_replace(telegram_personal_chat_id,
        '^[[:space:]]+|[[:space:]]+$', '', 'g'), '^@', '')) = $1
        AND coalesce(__nc_deleted, false) = false
      LIMIT 2`, [tag]);
    return result.rows.map(row => ({ clientName: row.client_name, chatId: row.secured_general_chat_id,
      invitationLink: row.secured_general_chat_invitation_link }));
  }));
}

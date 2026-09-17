import { createRequire } from 'node:module';
const { TABLES } = createRequire(import.meta.url)('../../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string }>;
};
export const tableIds = { clients: TABLES.clients.id, accounts: TABLES.platformAccounts.id, platforms: TABLES.platforms.id,
  profiles: TABLES.dolphinProfiles.id, cv: TABLES.cvProcessing.id, responses: TABLES.providerResponses.id,
  english: TABLES.englishLevels.id, stacks: TABLES.stacks.id, mentors: 'mp1s5wh87xtdi6k', market: 'molt1q7vu7peibh' };
export const readable = new Set(Object.values(tableIds));
export const relations: Record<string, Readonly<Record<string, string>>> = {
  [tableIds.clients]: { rel_clients_primary_stack: tableIds.stacks, market: tableIds.market,
    'English level': tableIds.english, Mentors: tableIds.mentors },
  [tableIds.accounts]: { rel_platformAccounts_platform: tableIds.platforms },
  [tableIds.profiles]: { rel_dolphinProfiles_client: tableIds.clients },
  [tableIds.cv]: { client: tableIds.clients },
  [tableIds.responses]: { client: tableIds.clients }
};

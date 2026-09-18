import { createRequire } from 'node:module';
import { createSqlProfileStore } from '../../../linkedin-automation/storage-postgres/profile-store.mts';
import { createSqlCommentStore } from '../../../linkedin-automation/storage-postgres/comment-store.mts';
import { createSqlInviterStore } from '../../../linkedin-automation/storage-postgres/inviter-store.mts';
import { createSqlPostStore } from '../../../linkedin-automation/storage-postgres/post-store.mts';
import type { FeatureWrites } from '../../../linkedin-automation/storage-postgres/contracts.mts';
import type { LinkedInStorageOptions } from '../storage-options.ts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import { createSqlConsoleRepository } from './repository.mts';
import { createSqlLinkedInStorage } from './linkedin-repository.mts';
import { consoleRecords } from './records.mts';
import { tableIds } from './tables.mts';
const { createNocoGenerationRepository } = createRequire(import.meta.url)(
  '../../../linkedin-automation/profile-filler/generation/noco-generation-context.ts') as
  { createNocoGenerationRepository(repository: LinkedInStorageOptions['repository'],
    records: ReturnType<typeof consoleRecords>): LinkedInStorageOptions['generation'] };

// Storage only: no timers, recovery, network providers or environment reads.
export function sqlAppOptions(db: ConsoleSql, grant: ConsoleWrites, features: FeatureWrites) {
  const records = consoleRecords(db), auth = createSqlLinkedInStorage(db, grant);
  const linkedinStorage: LinkedInStorageOptions = {
    ...auth, profile: createSqlProfileStore(db, features), comments: createSqlCommentStore(db, features),
    inviter: createSqlInviterStore(db, features),
    generation: createNocoGenerationRepository(auth.repository, records),
    posts: { store: createSqlPostStore(db, features), cvRows: () => records.fetchRecords(tableIds.cv) }
  };
  return { repository: createSqlConsoleRepository(db, grant), linkedinStorage };
}

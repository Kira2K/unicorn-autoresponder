import { createRequire } from 'node:module';
import { consoleRecords } from './records.mts';
import { tableIds } from './tables.mts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import type { AuthRepository } from './linkedin-contracts.mts';
import type { SqlFeatureProviders } from './feature-providers.mts';
import { createPostSource } from '../../../linkedin-automation/post-writer/source.ts';
import { createCvFiles } from '../../../linkedin-automation/post-writer/cv-files.ts';
const require = createRequire(import.meta.url);
const { selectFinalEnglishCv } = require('../../../linkedin-automation/profile-filler/generation/cv-source.ts') as
  typeof import('../../../linkedin-automation/profile-filler/generation/cv-source.ts');
const { createNocoGenerationRepository } = require('../../../linkedin-automation/profile-filler/generation/noco-generation-context.ts') as {
  createNocoGenerationRepository(repository: AuthRepository, records: ReturnType<typeof consoleRecords>): unknown };
export function createFeatureCv(db: ConsoleSql, repository: AuthRepository, grant: ConsoleWrites, providers: SqlFeatureProviders['posts']) {
  const records = consoleRecords(db);
  return {
    generationRepository: createNocoGenerationRepository(repository, records),
    source: { ...createCvFiles(providers.files, providers.cv.extractFacts), ...createPostSource({
      accounts: () => repository.listAccounts(), selectCv: selectFinalEnglishCv, ...providers.cv,
      cvRows: async () => {
        const rows = [];
        for (const id of grant.clientIds) rows.push(...await records.fetchRecords(tableIds.cv, 100, { where: `(clients_id,eq,${id})` }));
        return rows;
      }
    }) }
  };
}

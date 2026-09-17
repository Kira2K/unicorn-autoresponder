import type { ProfileClient } from '../../../linkedin-automation/profile-filler/plan-types.ts';
import type { ExecutorOptions } from '../../../linkedin-automation/profile-filler/executor.ts';
import type { createProfileGenerator } from '../../../linkedin-automation/profile-filler/generation/openai-generator.ts';
import type { CvDocument } from '../../../linkedin-automation/profile-filler/generation/types.ts';
import type { createCommentUnipileAdapter } from '../../../linkedin-automation/comment-monitor/unipile-adapter.ts';
import type { createCommentOpenAi } from '../../../linkedin-automation/comment-monitor/openai-client.ts';
import type { createConnectionInviterService } from '../../../linkedin-automation/connection-inviter/service.ts';
import type { Dependencies } from '../../../linkedin-automation/post-writer/types.ts';
import type { SourceDependencies } from '../../../linkedin-automation/post-writer/source-types.ts';
import type { JsonFiles } from '../../../linkedin-automation/post-writer/json-files.ts';
import type { AuthTestExecute } from './linkedin-contracts.mts';
export interface SqlFeatureProviders {
  auth: AuthTestExecute;
  profile: { client: ProfileClient; executorOptions: ExecutorOptions; runtime: {
    config: { model: string }; generator: Pick<ReturnType<typeof createProfileGenerator>, 'extractFacts' | 'generateProfile'> &
      Partial<Pick<ReturnType<typeof createProfileGenerator>, 'repairProfile' | 'chooseJobTitles'>>;
    loadCv(url: string): Promise<CvDocument>; loadProfile(id: number): Promise<unknown>; resolveCountry(proxy: unknown): Promise<string>;
  } };
  comments: { adapter: ReturnType<typeof createCommentUnipileAdapter>; openai: ReturnType<typeof createCommentOpenAi>;
    sleep(ms: number): Promise<void>; random(): number };
  inviter: Required<Pick<NonNullable<Parameters<typeof createConnectionInviterService>[0]>, 'adapter' | 'now' | 'sleep' | 'random' | 'logger'>>;
  posts: Pick<Dependencies, 'generator' | 'adapter' | 'memes' | 'now' | 'random' | 'log'> & {
    cv: Pick<SourceDependencies, 'loadCv' | 'extractFacts'>; files: JsonFiles;
  };
}

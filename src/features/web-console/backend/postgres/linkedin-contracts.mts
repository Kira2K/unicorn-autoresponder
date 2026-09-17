import type { LinkedInAuthAccountRow, LinkedInAuthTarget } from '../../../linkedin-automation/account-connection/types.ts';
import type { LinkedInAuthAction, LinkedInAuthRun } from '../linkedin-auth-types.ts';
export type AuthSuccess = { accountId: string; accountStatus: string; providerId: string;
  profileUrl: string; profileName: string; now?: () => Date };
export type AuthFailure = { errorCode: string; accountStatus?: string; now?: () => Date };
export interface AuthRepository {
  assertSchema(): Promise<void>;
  listAccounts(): Promise<LinkedInAuthAccountRow[]>;
  getAccount(id: number, options?: { fresh?: boolean }): Promise<LinkedInAuthAccountRow | undefined>;
  resolveTarget(name: string, id?: number): Promise<LinkedInAuthTarget>;
  listStacks(): Promise<Array<{ id: number; name: string }>>;
  updatePrimaryStack(clientId: number, stackId: number): Promise<{ id: number; name: string }>;
  updateLinkedInUrl(id: number, url: unknown): Promise<string>;
  recordSuccess(id: number, input: AuthSuccess): Promise<void>;
  recordFailure(id: number, input: AuthFailure): Promise<void>;
  requiredColumns: string[];
}
export interface AuthHistory {
  start(run: LinkedInAuthRun): Promise<void>;
  finish(run: LinkedInAuthRun): Promise<void>;
  list(): Promise<Record<string, unknown>[]>;
}
// The isolated composition requires an explicit fake executor; no live default is allowed.
export type AuthTestExecute = (account: LinkedInAuthAccountRow, action: LinkedInAuthAction,
  onEvent: (event: { stage: string; status: string }) => void, repository: AuthRepository) => Promise<Record<string, unknown>>;

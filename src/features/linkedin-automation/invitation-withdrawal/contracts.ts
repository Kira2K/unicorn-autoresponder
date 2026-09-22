export type Invitation = { id: string; name: string; createdAt?: string }
export type Candidate = Invitation & { ageDays?: number; eligible: boolean; reason?: string }
export type Account = { platformAccountId: number; accountId: string;
  linkedinUrl: string; verifiedProviderId?: string }
export type Provider = {
  verify(account: Account): Promise<void>
  list(accountId: string): Promise<Invitation[]>
  cancel(accountId: string, requestId: string): Promise<void>
}
export type Run = { id: string; platformAccountId: number; accountId: string; automationKey?: string; errorCode?: string;
  status: 'running' | 'completed' | 'stopped' | 'failed' | 'uncertain' | 'interrupted';
  total: number; withdrawn: number; skipped: number; current?: string;
  stopRequested?: boolean; error?: string; nextActionAt?: string; checkedAt?: string; retryAttempt?: number }
export type State = { accountId: string; attempted: string[]; run?: Run; retryAt?: number }
export type Store = { load(id: number): Promise<State | undefined>; save(id: number, state: State): Promise<void> }
export type Preview = { token: string; account: Account; expiresAt: number; items: Candidate[]; automationKey?: string }
export type Runtime = {
  executionGuard?: import('../orchestrator/contracts.ts').ExecutionGuard;
  audit?(event:string,fields:Record<string,unknown>):void;
  provider(): Provider; store: Store; account(id: number): Promise<Account>;
  assertWrite(id: number): void; assertRead(id: number): void; writable(): boolean;
  gate: { acquire(kind: string, id: string, accountKey: string): (() => void) | undefined };
  now(): number; random(): number; sleep(ms: number): Promise<void>
}
export type WithdrawalService = {
  estimateAutomatic?(id:number):Promise<number>
  startAutomatic?(id: number, key: string): Promise<Run>
  preview(id: number): Promise<{ token: string; items: Candidate[]; writerEnabled: boolean }>
  start(id: number, token: string): Promise<Run>
  status(id: number): Promise<Run | undefined>
  stop(id: number): Promise<Run | undefined>
  recheck(id: number, runId: string): Promise<Run | undefined>
  busy(): boolean
  close(): Promise<void>
}

export type Invitation = { id: string; name: string; createdAt?: string }
export type Candidate = Invitation & { ageDays?: number; eligible: boolean; reason?: string }
export type Account = { platformAccountId: number; accountId: string;
  linkedinUrl: string; verifiedProviderId?: string }
export type Provider = {
  verify(account: Account): Promise<void>
  list(accountId: string): Promise<Invitation[]>
  cancel(accountId: string, requestId: string): Promise<void>
}
export type Run = { id: string; platformAccountId: number; accountId: string;
  recovery?: Record<string, import('../action-recovery.ts').ActionRecovery>;
  recoveryClosed?: boolean;
  automationId?: string;
  status: 'running' | 'completed' | 'stopped' | 'failed' | 'uncertain' | 'interrupted';
  total: number; withdrawn: number; skipped: number; current?: string;
  // Successful API receipts, included in withdrawn; checkedAt marks the full batch read-back.
  confirmed?: string[];
  // Absent after an ambiguous response, included in skipped, never claimed as our cancellation.
  noLongerPending?: string[];
  // A checked but still visible ambiguous cancellation is never sent again.
  unconfirmed?: string[]; verificationAt?: string; verificationChecks?: number;
  targets?: Candidate[]; cursor?: number; approvedAccount?: Account;
  stopRequested?: boolean; error?: string; nextActionAt?: string; checkedAt?: string; retryAttempt?: number }
export type State = { accountId: string; attempted: string[]; run?: Run; retryAt?: number }
export type Store = { load(id: number): Promise<State | undefined>; save(id: number, state: State): Promise<void> }
export type Preview = { token: string; account: Account; expiresAt: number; items: Candidate[] }
export type Runtime = {
  cooperative?: boolean;
  provider(): Provider; store: Store; account(id: number): Promise<Account>;
  // Never cancel a request that could belong to an unresolved invitation attempt.
  protectedSince?(id: number): Promise<number | undefined>;
  assertWrite(id: number): void; assertRead(id: number): void; writable(): boolean;
  gate: { acquire(kind: string, id: string, accountKey: string): (() => void) | undefined };
  now(): number; random(): number; sleep(ms: number): Promise<void>
}
export type WithdrawalService = {
  resumeManaged?(id: number, runId: string): Promise<void>
  startAutomatic?(id: number, key: string): Promise<Run>
  stepManaged?(id: number, runId: string, stop?: boolean): Promise<import('../execution-step.ts').ExecutionStep>
  preview(id: number): Promise<{ token: string; items: Candidate[]; writerEnabled: boolean }>
  start(id: number, token: string): Promise<Run>
  status(id: number): Promise<Run | undefined>
  stop(id: number): Promise<Run | undefined>
  recheck(id: number, runId: string): Promise<Run | undefined>
  resume(id: number, runId: string): Promise<Run | undefined>
  busy(): boolean
  close(): Promise<void>
}

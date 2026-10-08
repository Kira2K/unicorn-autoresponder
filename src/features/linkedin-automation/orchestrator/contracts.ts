import type { ExecutionStep } from '../execution-step.ts'

export const features = ['invitations', 'posts', 'comments', 'withdrawals'] as const
export type Feature = typeof features[number]
export type Slot = { id: string; day: number; start: number; end: number; features: Feature[] }
export type Account = { id: number; studentId: number; name: string; key: string; unipileId: string }
export type PostPolicy = { contentMode: 'generated' | 'prepared'; generateIfMissing: boolean }
export type Schedule = { account: Account; enabled: boolean; version: number; slots: Slot[];
  updatedAt: number; commentsActivatedAt?: number; postPolicy?: PostPolicy }
export type TaskState = 'planned' | 'running' | 'waiting' | 'verifying' | 'completed' | 'stopped' | 'needs_attention'
export type Task = { id: string; account: Account; feature: Feature; day: string; slotId: string;
  preparationRecovery?: import('../action-recovery.ts').ActionRecovery;
  summary?: import('../action-recovery.ts').ActionSummary;
  reportedSkips?: string[];
  recoveryDeadlineAt?: number;
  scheduleVersion: number; plannedAt: number; nextAt: number; windowEnd: number; postPolicy?: PostPolicy;
  state: TaskState; runId?: string; createdAt: number; updatedAt: number; startedAt?: number;
  deadlineAt?: number; activeMs: number; activeLimitMs: number; elapsedLimitMs: number;
  reason?: string; attempts: number; version: number; stopped?: boolean; stopApplied?: boolean;
  stage?: string; stageMessage?: string; uncertainSince?: number; publishedAt?: number; retryRequested?: boolean }
export type Event = { id?: number; at: number; taskId?: string; studentId?: number; accountId?: number;
  feature?: string; source: 'Unipile' | 'SQL' | 'Dolphin' | 'OpenAI' | 'наш код';
  code: string; message: string; nextAt?: number; httpStatus?: number; version?: string;
  operation?: string; stage?: string; requestId?: string; runId?: string; actionId?: string; initiator?: string; durationMs?: number; diagnostic?: string }
export type Snapshot = { schedules: Schedule[]; tasks: Task[]; owner?: { id: string; until: number; epoch: number } }
export type HistoryFilter = { latest?: boolean; before?: number; source?: string; feature?: string; errorsOnly?: boolean; from?: number; to?: number }
export type Cooldown = { account: string; method: string; until: number; code: string; observedAt: number }
export interface Store {
  ready(): Promise<boolean>
  snapshot(): Promise<Snapshot>
  schedule(value: Schedule, expectedVersion: number): Promise<Schedule>
  create(tasks: Task[]): Promise<void>
  save(task: Task, event: Event, owner: string, epoch: number): Promise<Task>
  history(account?: number, after?: number, limit?: number, filter?: HistoryFilter): Promise<Event[]>
  durations(feature: Feature, account: string): Promise<number[]>
  claim(owner: string, now: number): Promise<number | undefined>
  owned(owner: string, epoch: number, now: number): Promise<void>
  release(owner: string, epoch: number): Promise<void>
  cooldown(value: Cooldown): Promise<void>
  // 'action' is local pacing; '*' pauses the account; other keys are normalized HTTP routes.
  blockedUntil(account: string, method: string, now: number): Promise<number>
  cooldowns?(): Promise<Cooldown[]>
  event(event: Event): Promise<void>
  pruneLogs(before: number): Promise<void>
}
export type StepContext = { task: Task; now(): number; signal: AbortSignal;
  stage?(code: string, message: string): Promise<void>;
  cooperate<T>(action: () => Promise<T>, until?: number, verifying?: boolean): Promise<T>;
  waitForRequest?<T>(action: () => Promise<T>): Promise<T>;
  bind(runId: string): Promise<void>; assertWrite(): Promise<void> }
export interface FeatureAdapter {
  resume?(context: StepContext): Promise<void>
  estimate(task: Task): Promise<number>
  step(context: StepContext): Promise<ExecutionStep & { runId?: string; publishedAt?: number }>
  stop(context: StepContext): Promise<ExecutionStep>
}
export type Adapters = Record<Feature, FeatureAdapter>
export const fail = (code: string, message = code, nextAt?: number) =>
  Object.assign(new Error(message), { code, ...(nextAt === undefined ? {} : { nextAt }) })
export const terminal = (task: Task) => ['completed', 'stopped', 'needs_attention'].includes(task.state)

export function accountKey(row: { verifiedProviderId?: string; unipileAccountId?: string }) {
  if (row.verifiedProviderId) return `linkedin:${row.verifiedProviderId}`
  if (row.unipileAccountId) return `unipile:${row.unipileAccountId}`
  throw fail('automation_account_unverified', 'У аккаунта нет проверенного ID LinkedIn или ID Unipile.')
}

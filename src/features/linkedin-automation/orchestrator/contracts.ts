export const features = ['invitations', 'posts', 'comments', 'withdrawals'] as const
export type Feature = typeof features[number]
export type WeekSlot = { id: string; day: number; start: string; end: string; features: Feature[] }
export type AutomationSettings = { account: number; enabled: boolean; revision: number;
  timezone: 'Europe/Moscow'; slots: WeekSlot[]; updatedAt: number; managed?: boolean }
export type RunState = 'planned' | 'starting' | 'running' | 'monitoring' | 'completed' |
  'blocked' | 'cancelled' | 'missed'
export type AutomationRun = { key: string; account: number; feature: Feature; date: string;
  slotId: string; opensAt: number; closesAt: number; plannedAt: number; reserveMs: number;
  state: RunState; reason?: string; featureRunId?: string; startedAt?: number; finishedAt?: number;
  updatedAt: number; stopRequested?: boolean; stopReason?: 'disabled_by_admin' | 'task_time_limit';
  pauseBeforeMs?: number; releasedAt?: number; deadlineAt?: number;
  commentMode?: 'continuous'; publication?: {id:string;at:number} }
export interface AutomationStore {
  settings(): Promise<AutomationSettings[]>
  saveSettings(value: AutomationSettings, expectedRevision: number, event?:AuditEvent): Promise<AutomationSettings>
  runs(account?: number): Promise<AutomationRun[]>
  claim(value: AutomationRun): Promise<AutomationRun>
  saveRun(value: AutomationRun, event?: AuditEvent): Promise<void>
  appendEvent(event: AuditEvent): Promise<void>
  events(query: { account?: number; runKey?: string; before?: number; limit?: number }): Promise<AuditEvent[]>
  heartbeat(value?: WorkerHeartbeat): Promise<WorkerHeartbeat | undefined>
}
export type AuditEvent = { id?: number; at: number; account?: number; runKey?: string; feature?: Feature;
  level: 'info' | 'warning' | 'error'; stage: string; code: string;
  details?: Record<string, string | number | boolean> }
export type WorkerHeartbeat = { instance: string; at: number; startedAt: number; state: 'ready' | 'recovering' | 'error' | 'stopped'; code?: string }
export type FeatureState = { id: string; state: 'running' | 'monitoring' | 'completed' | 'blocked' | 'stopped';
  reason?: string; owned: boolean; publication?: {id:string;at:number} }
export interface FeatureAdapter {
  inspect(account: number): Promise<{ ready: boolean; reason?: string; estimateMs?: number; busy?: boolean }>
  start(run: AutomationRun): Promise<FeatureState>
  status(run: AutomationRun): Promise<FeatureState | undefined>
  stop(run: AutomationRun): Promise<void>
  maintain?(run: AutomationRun): Promise<void>
}
export type AutomationAdapters = Record<Feature, FeatureAdapter>
export interface ExecutionAuthority {
  assertOwned(): void
  check(): Promise<void>
}
export type ExecutionGuard = { beforeWrite(account: number, feature: Feature | 'profile' | 'auth',
  automationKey?: string): Promise<void>;
  afterWrite?(account:number,feature:Feature,automationKey:string|undefined,result:string):Promise<void> }
export const automationError = (code: string) => Object.assign(new Error(code), { code })
export const emptySettings = (account: number): AutomationSettings => ({ account, enabled: false,
  revision: 0, timezone: 'Europe/Moscow', slots: [], updatedAt: 0 })
export const enabledFor = (settings: AutomationSettings | undefined, feature: Feature) =>
  Boolean(settings?.enabled && settings.slots.some(slot => slot.features.includes(feature)))

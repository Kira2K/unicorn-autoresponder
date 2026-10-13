/** Persist with the logical action, never with a process or a retry attempt.
 * Expiry only ends automatic recovery. It is not evidence that a write failed.
 */
export type ActionRecovery = { firstFailedAt: number; skippedAt?: number;
  httpStatus?: number; errorCode?: string; stage?: string; requestId?: string; source?: 'Unipile' | 'OpenAI' }
export const ACTION_RECOVERY_MS = 20 * 60_000
export const ACTION_SKIPPED = 'unipile_action_skipped'

export function serverFailure(error: any) {
  const status = Number(error?.details?.httpStatus ?? error?.httpStatus ?? error?.status)
  return status >= 500 && status <= 599
}
export function recordFailure(previous: ActionRecovery | undefined, error: any, now: number) {
  if (!serverFailure(error)) return previous
  const token = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,120}$/.test(value) ? value : undefined
  return { ...previous, firstFailedAt: previous?.firstFailedAt ?? now,
    httpStatus: Number(error?.details?.httpStatus ?? error?.httpStatus ?? error?.status),
    errorCode: token(error?.code), stage: token(error?.details?.requestStage) ?? (/openai/.test(error?.code ?? '') ? 'text_generation' : undefined),
    source: /openai/.test(error?.code ?? '') ? 'OpenAI' as const : 'Unipile' as const, requestId: token(error?.details?.requestId) }
}
export function recoveryExpired(value: ActionRecovery | undefined, now: number) {
  return !!value && (value.skippedAt !== undefined || now >= value.firstFailedAt + ACTION_RECOVERY_MS)
}
export function recoveryWakeAt(value: ActionRecovery | undefined, retryAt: number) {
  return value && value.skippedAt === undefined ? Math.min(retryAt, value.firstFailedAt + ACTION_RECOVERY_MS) : retryAt
}
export function skipRecovery(value: ActionRecovery, now: number) { value.skippedAt ??= now }
export function recoveryDeadline(values: Record<string, ActionRecovery> = {}) {
  const deadlines = Object.values(values).filter(value => value.skippedAt === undefined)
    .map(value => value.firstFailedAt + ACTION_RECOVERY_MS)
  return deadlines.length ? Math.min(...deadlines) : undefined
}
export function skippedAction() {
  return Object.assign(new Error('Действие пропущено: за 20 минут не удалось восстановиться после ошибки сервиса.'),
    { code: ACTION_SKIPPED })
}
export type ActionSummary = { completed: number; skipped: number; unconfirmed: number }
export type SkippedAction = Omit<ActionRecovery, 'firstFailedAt' | 'skippedAt'> & { actionId: string }
export function skippedActions(values: Record<string, ActionRecovery> = {}): SkippedAction[] {
  return Object.entries(values).filter(([, value]) => value.skippedAt !== undefined).map(([actionId, value]) => ({
    actionId, httpStatus: value.httpStatus, errorCode: value.errorCode, stage: value.stage, requestId: value.requestId, source: value.source }))
}
export function summaryMessage(value: ActionSummary) {
  return `Выполнено: ${value.completed}; пропущено: ${value.skipped}; не подтверждено: ${value.unconfirmed}.`
}

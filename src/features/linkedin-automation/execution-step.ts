/** A yielded step has no outstanding provider request and its state is durable.
 * The driver may let another feature run before advancing the same iterator.
 * After a process restart, create an iterator from the saved run instead.
 */
export type ExecutionStep = {
  status: 'ready' | 'waiting' | 'verifying' | 'completed' | 'stopped' | 'needs_attention'
  nextActionAt?: string
  reason?: string
  summary?: import('./action-recovery.ts').ActionSummary
  skippedActions?: import('./action-recovery.ts').SkippedAction[]
  recoveryDeadlineAt?: number
}

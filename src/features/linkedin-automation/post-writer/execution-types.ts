import type { Context, Dependencies, PostRun, Settings, PostAdapter, PostSource, PostStore } from './types.ts'
export type Execution = Dependencies & {
  isClosing?(): boolean
  save(run: PostRun): Promise<void>
  settings(account: number): Settings
  saveSettings(value: Settings): Promise<void>
  saveContext(account: number, context: Context): Promise<void>
  release: Map<number, { id: string; release: () => void }>
  generationControllers: Map<string, AbortController>
}
export type GenerationExecution = Pick<Execution,
  'source' | 'generator' | 'save' | 'settings' | 'saveContext' | 'generationControllers' | 'memes' | 'log'> & {
    store: Pick<PostStore, 'list'>
  }
type GateExecution = Pick<Execution, 'release' | 'gate'>
export type PublicationExecution = GateExecution & Pick<Execution, 'save' | 'now' | 'isClosing'> & {
  memes?: Pick<NonNullable<Execution['memes']>, 'assets'>
  settings?: Execution['settings']
  store: Pick<PostStore, 'put' | 'claim'>
  adapter: Pick<PostAdapter, 'identity' | 'publish' | 'read' | 'recent'>
}
export type EngagementExecution = GateExecution & Pick<Execution, 'save' | 'now' | 'random' | 'settings' | 'isClosing' | 'unknownLockGraceMs'> & {
  log?: Execution['log']
  reportLikeEvent?: Execution['reportLikeEvent']
  source: Pick<PostSource, 'accounts'>
  adapter: Pick<PostAdapter, 'identity' | 'reacted' | 'reactions' | 'like'>
}
export function unlock(execution: Pick<GateExecution, 'release'>, account: number) {
  execution.release.get(account)?.release()
  execution.release.delete(account)
}
export function lock(execution: GateExecution, account: number, id: string, kind = 'post_writer') {
  const current = execution.release.get(account)
  if (current && current.id !== id) throw Object.assign(new Error('linkedin_operation_active'), { code: 'linkedin_operation_active' })
  if (!current) execution.release.set(account, { id,
    release: execution.gate.acquire(kind, id, String(account)) })
}

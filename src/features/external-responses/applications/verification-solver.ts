import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicJson, safeId } from '../infrastructure/store.ts'

/** Assets must come from a provider DOM extractor, never a page screenshot or CV. */
export type VerifiedDragAssets = { source: 'provider_dom'; background: Buffer; images: { bytes: Buffer; from: { x: number; y: number } }[]; instruction: string }
export type DragSolution = { coordinates: ({ x: number; y: number } | null)[] }
export type VerificationSolver = { solve(assets: VerifiedDragAssets, snapshotId: string): Promise<DragSolution> }

export function createTwoCaptchaDragSolver(config: { enabled: boolean; key?: string; intentDirectory: string; fetch?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void> }): VerificationSolver {
  return { async solve(assets, snapshotId) {
    if (!config.enabled) throw Error('verification_provider_not_enabled')
    if (!config.key?.trim()) throw Error('verification_provider_key_missing')
    if (assets.source !== 'provider_dom' || !assets.background.length || !assets.images.length || assets.images.length > 5 || assets.images.some(i => !i.bytes.length) || !assets.instruction.trim()) throw Error('verification_assets_unsupported')
    const path = join(config.intentDirectory, `${safeId(snapshotId)}.json`)
    const now = config.now ?? Date.now, fetchImpl = config.fetch ?? fetch, wait = config.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
    await mkdir(config.intentDirectory, { recursive: true })
    let intent
    try { intent = await open(path, 'wx', 0o600) } catch (error: any) { if (error.code === 'EEXIST') throw Error('verification_solver_intent_consumed'); throw error }
    try { await intent.writeFile(JSON.stringify({ snapshotId, status: 'create_intent', at: new Date(now()).toISOString() })); await intent.sync() }
    finally { await intent.close() }
    const deadline = now() + 45_000
    const post = async (endpoint: string, body: object) => {
      if (now() >= deadline) throw Error('verification_provider_timeout')
      const response = await fetchImpl(`https://api.2captcha.com/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(15_000, deadline - now())), redirect: 'error' })
      if (!response.ok) throw Error(`verification_provider_http_${response.status}`)
      return response.json() as Promise<any>
    }
    let taskId: number
    try {
      const created = await post('createTask', { clientKey: config.key, task: { type: 'DragAndDropTask', background: assets.background.toString('base64'), images: assets.images.map(i => i.bytes.toString('base64')), comment: assets.instruction } })
      if (created.errorId !== 0 || !Number.isInteger(created.taskId)) throw Error('verification_provider_create_failed')
      taskId = created.taskId
      await atomicJson(path, { snapshotId, status: 'polling', taskId, at: new Date(now()).toISOString() })
    } catch (error) { await atomicJson(path, { snapshotId, status: 'create_uncertain', at: new Date(now()).toISOString() }); throw error }
    for (let attempt = 0; attempt < 8 && now() < deadline; attempt++) {
      await wait(Math.min(5000, deadline - now()))
      const result = await post('getTaskResult', { clientKey: config.key, taskId })
      if (result.errorId !== 0) throw Error('verification_provider_result_failed')
      if (result.status !== 'ready') continue
      const coordinates = result.solution?.coordinates
      if (!Array.isArray(coordinates) || coordinates.length !== assets.images.length || coordinates.some((p: any) => p !== null && (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)))) throw Error('verification_provider_solution_invalid')
      await atomicJson(path, { snapshotId, status: 'ready', taskId, at: new Date(now()).toISOString() })
      return { coordinates }
    }
    throw Error('verification_provider_timeout')
  } }
}

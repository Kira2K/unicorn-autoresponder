import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Page } from 'playwright'
import { isLinkedInUrl } from '../../infrastructure/navigation-policy.ts'
import { guardJevNetwork } from './network-guard.ts'

type Action = { id: string; node?: number; kind: string; value?: string; label: string; delta?: number }
export type JevObservation = { url: string; text: string; actions: Action[]; marker: unknown; page_key: unknown; guards: Record<string, unknown>; omitted_actions: number }

export async function loadJevSnapshot() {
  const base = new URL('./vendor/', import.meta.url)
  const provenance = JSON.parse(await readFile(new URL('provenance.json', base), 'utf8'))
  const source = await readFile(new URL('snapshot.js', base), 'utf8')
  if (createHash('sha256').update(source).digest('hex') !== provenance.files.find((f: any) => f.name === 'snapshot.js')?.sha256) throw Error('jev_snapshot_hash_mismatch')
  return source
}

/** Experimental host-controlled port. Receives one owned tab, never owns its profile/context. */
export async function createJevBrowserAdapter(input: {
  page: Page; snapshot: string; allowedOrigins: string[]; allowedControls: string[]
  signal?: AbortSignal; maxActions?: number; minIntervalMs?: number
  event?: (event: { action: string; outcome: string; ordinal: number }) => Promise<void>
}) {
  const { page } = input, issued = new WeakMap<object, { value: JevObservation; serialized: string }>(), consumed = new WeakSet<object>()
  if (!Number.isSafeInteger(input.maxActions ?? 20) || (input.maxActions ?? 20) < 1 ||
      !Number.isFinite(input.minIntervalMs ?? 250) || (input.minIntervalMs ?? 250) < 0 || !input.allowedOrigins.length) throw Error('jev_invalid_limits')
  const origins = new Set(input.allowedOrigins.map(u => new URL(u).origin))
  // Quarantined after failed local guards: this experimental port cannot admit live origins.
  if ([...origins].some(u => !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(u).hostname))) throw Error('jev_live_adapter_not_validated')
  let closed = false, active = false, uncertain = false, count = 0, lastAction = 0
  const allowedUrl = (url: string) => { try { return !isLinkedInUrl(url) && origins.has(new URL(url).origin) } catch { return false } }
  const network = await guardJevNetwork(page, allowedUrl)
  const check = () => {
    if (closed || input.signal?.aborted || page.isClosed()) throw Error('jev_session_stopped')
    if (uncertain) throw Error('jev_action_uncertain_session')
    network.assertHealthy()
  }
  const popup = (p: Page) => { void p.close().catch(() => {}) }
  page.on('popup', popup)
  const permitted = async (node: number) => page.evaluate(({ node, selectors, origins }) => {
    const e = (window as any).__jevFast?.nodes.get(node) as HTMLElement | undefined
    if (!e?.isConnected || e.closest('form') || ('form' in e && e.form) || !selectors.some(s => e.matches(s))) return false
    if (e instanceof HTMLInputElement && ['password', 'email', 'file', 'submit'].includes(e.type)) return false
    if (e instanceof HTMLAnchorElement) {
      const url = new URL(e.href)
      if (!origins.includes(url.origin) || url.username || url.password || (e.target && e.target !== '_self') || e.hasAttribute('download')) return false
    }
    return true
  }, { node, selectors: input.allowedControls, origins: [...origins] })
  const observe = async (): Promise<JevObservation> => {
    check(); if (!allowedUrl(page.url())) throw Error('jev_navigation_forbidden')
    const state = await page.evaluate(input.snapshot) as JevObservation | null
    if (!state) throw Error('jev_page_not_ready')
    const actions: Action[] = []
    for (const action of state.actions) if (action.kind === 'wait' || action.kind === 'scroll' ||
        (Number.isSafeInteger(action.node) && await permitted(action.node!))) actions.push(action)
    state.actions = actions; issued.set(state, { value: structuredClone(state), serialized: JSON.stringify(state) })
    return state
  }
  const fresh = async (state: JevObservation) => {
    check(); const saved = issued.get(state)
    if (!saved || consumed.has(state) || saved.serialized !== JSON.stringify(state)) return false
    const now = await page.evaluate(input.snapshot) as JevObservation | null
    return !!now && JSON.stringify(now.marker) === JSON.stringify(saved.value.marker)
  }
  let closing: Promise<void> | undefined
  const close = () => {
    if (closing) return closing
    closed = true
    closing = (async () => {
      page.off('popup', popup)
      try { await page.close().catch(() => {}) } finally {
        await network.close()
        input.signal?.removeEventListener('abort', abort)
      }
    })()
    return closing
  }
  const abort = () => { void close().catch(() => {}) }
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) await close()
  return {
    observe, fresh, close,
    async act(state: JevObservation, actionId: string, text?: string) {
      check(); if (active) throw Error('jev_concurrent_action')
      if (count >= (input.maxActions ?? 20)) throw Error('jev_action_budget_exhausted')
      active = true
      try {
        const delay = Math.max(0, (input.minIntervalMs ?? 250) - (Date.now() - lastAction))
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        check(); if (!await fresh(state)) throw Error('jev_stale_observation')
        const action = issued.get(state)!.value.actions.find(a => a.id === actionId)
        if (!action) throw Error('jev_action_not_observed')
        if (action.node !== undefined && !await permitted(action.node)) throw Error('jev_control_forbidden')
        if (action.kind === 'fill' && (typeof text !== 'string' || text.length > 2000)) throw Error('jev_invalid_text')
        if (!['wait', 'scroll', 'click', 'fill', 'select'].includes(action.kind)) throw Error('jev_action_unsupported')
        consumed.add(state); count++; lastAction = Date.now()
        try {
          if (action.kind === 'wait') await new Promise(resolve => setTimeout(resolve, 100))
          else if (action.kind === 'scroll') await page.mouse.wheel(0, action.delta!)
          else {
            const handle = await page.evaluateHandle(node => (window as any).__jevFast?.nodes.get(node), action.node)
            try {
              const element = handle.asElement(); if (!element) throw Error('jev_target_missing')
              if (action.kind === 'click') await element.click({ timeout: 1500 })
              else if (action.kind === 'fill') await element.fill(text!, { timeout: 1500 })
              else await element.selectOption(action.value!, { timeout: 1500 })
            } finally { await handle.dispose() }
          }
          check()
          await input.event?.({ action: action.kind, outcome: 'executed', ordinal: count })
        } catch (error) { uncertain = true; throw new Error('jev_action_uncertain_do_not_retry', { cause: error }) }
      } finally { active = false }
    }
  }
}

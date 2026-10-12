import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Page, ElementHandle } from 'playwright'
import { puzzleInstruction } from './captcha.ts'
import type { VerificationSolver, VerifiedDragAssets } from './verification-solver.ts'

type Rect = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type Snapshot = { id: string; frameIndex: number; frameSrc: string; handle: ElementHandle; pageUrl: string; frameBox: Rect; clip: Rect; pixelHash: string; createdAt: number; path: string; mode: 'dom' | 'visual'; visualConfirmedAt?: number }
const hcaptcha = (src: string) => { try { return /(^|\.)hcaptcha\.com$/.test(new URL(src).hostname) } catch { return false } }
const rectangle = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 20 && r.height >= 20 && r.width <= 1200 && r.height <= 900
const sameBox = (a: Rect, b: Rect) => [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every(n => Math.abs(n) <= 1)

/** Hash decoded pixels, so changing PNG metadata/encoding cannot masquerade as a changed challenge. */
export async function pixelHash(png: Buffer) {
  const image = await loadImage(png), canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height).data
  return createHash('sha256').update(Buffer.from(pixels)).update(`${image.width}x${image.height}`).digest('hex')
}

/** Controller lives only with the owned ATS page. It cannot submit an employer application. */
export function createVerificationController(page: Page, evidenceRoot: string, clock = () => Date.now(), automation?: {
  extract: (page: Page, region: Rect) => Promise<VerifiedDragAssets | undefined>; solver: VerificationSolver
}) {
  const snapshots = new Map<string, Snapshot>()
  const prune = () => { for (const [id, snapshot] of snapshots) if (clock() - snapshot.createdAt > 60_000) snapshots.delete(id) }
  async function frameAt(index: number) {
    const frame = (await page.locator('iframe').all())[index]
    if (!frame) throw Error('verification_frame_missing')
    const src = await frame.getAttribute('src') ?? '', box = await frame.boundingBox()
    if (!hcaptcha(src) || !await frame.isVisible() || !box || box.width <= 150 || box.height <= 150) throw Error('verification_frame_not_active')
    return { frame, src, box }
  }
  async function ownPuzzle(frame: Awaited<ReturnType<typeof frameAt>>['frame']) {
    const text = await frame.contentFrame().locator('body').innerText({ timeout: 300 }).catch(() => '')
    return puzzleInstruction(text)
  }
  async function validate(snapshot: Snapshot, points: Point[] = [], requireConfirmation = true) {
    if (clock() - snapshot.createdAt > 60_000 || page.isClosed()) throw Error('verification_snapshot_expired')
    if (page.url() !== snapshot.pageUrl) throw Error('verification_page_navigated')
    const { frame, src, box } = await frameAt(snapshot.frameIndex)
    if (src !== snapshot.frameSrc || !sameBox(box, snapshot.frameBox) || !await snapshot.handle.evaluate(el => el.isConnected)) throw Error('verification_frame_replaced')
    if (snapshot.mode === 'dom' && !await ownPuzzle(frame)) throw Error('verification_puzzle_unsupported')
    if (snapshot.mode === 'visual' && requireConfirmation && !snapshot.visualConfirmedAt) throw Error('verification_visual_confirmation_required')
    for (const point of points) {
      if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x >= snapshot.clip.width || point.y >= snapshot.clip.height) throw Error('verification_action_out_of_bounds')
      const hit = await snapshot.handle.evaluate((el, p) => document.elementFromPoint(p.x, p.y) === el, { x: snapshot.clip.x + point.x, y: snapshot.clip.y + point.y })
      if (!hit) throw Error('verification_frame_not_at_action_point')
    }
    if (await pixelHash(await page.screenshot({ type: 'png', clip: snapshot.clip })) !== snapshot.pixelHash) throw Error('verification_snapshot_stale')
  }
  return {
    async inspect() {
      if (page.isClosed()) throw Error('verification_page_closed')
      prune()
      const frames = await page.locator('iframe').all(), visible = []
      for (let i = 0; i < frames.length; i++) {
        const src = await frames[i].getAttribute('src') ?? '', box = await frames[i].boundingBox()
        if (hcaptcha(src) && await frames[i].isVisible() && box && box.width > 150 && box.height > 150) {
          const activePuzzle = await ownPuzzle(frames[i])
          // The live enclave can draw a puzzle while exposing no body text. Preserve
          // an image of this exact visible frame for inspection, without enabling actions.
          let visualObservation: { path: string; pixelHash: string; observedAt: string } | undefined
          if (!activePuzzle) {
            const png = await frames[i].screenshot({ type: 'png' })
            const path = join(evidenceRoot, 'verification', `${randomUUID()}.png`)
            await mkdir(join(evidenceRoot, 'verification'), { recursive: true })
            await writeFile(path, png, { mode: 0o600 })
            visualObservation = { path, pixelHash: await pixelHash(png), observedAt: new Date(clock()).toISOString() }
          }
          visible.push({ frameIndex: i, origin: new URL(src).origin, path: new URL(src).pathname, bounds: box, activePuzzle, visualObservation })
        }
      }
      return { activePuzzle: visible.some(frame => frame.activePuzzle), frames: visible }
    },
    async capture(frameIndex: number, region: Rect, mode: 'dom' | 'visual' = 'dom') {
      if (page.isClosed()) throw Error('verification_page_closed')
      prune()
      const { frame, src, box } = await frameAt(frameIndex)
      if (mode === 'dom' && !await ownPuzzle(frame) || !rectangle(region) || region.x < 0 || region.y < 0 || region.x + region.width > box.width || region.y + region.height > box.height) throw Error('verification_crop_invalid')
      const clip = { x: box.x + region.x, y: box.y + region.y, width: region.width, height: region.height }
      const handle = await frame.elementHandle()
      if (!handle) throw Error('verification_frame_replaced')
      const png = await page.screenshot({ type: 'png', clip }), id = randomUUID(), path = join(evidenceRoot, 'verification', `${id}.png`)
      await mkdir(join(evidenceRoot, 'verification'), { recursive: true }); await writeFile(path, png, { mode: 0o600 })
      const after = await frameAt(frameIndex)
      if (after.src !== src || !sameBox(after.box, box) || !await handle.evaluate(el => el.isConnected)) throw Error('verification_frame_replaced')
      snapshots.set(id, Object.freeze({ id, frameIndex, frameSrc: src, handle, pageUrl: page.url(), frameBox: box, clip, pixelHash: await pixelHash(png), createdAt: clock(), path, mode }))
      return { id, path, mode, createdAt: new Date(clock()).toISOString(), expiresAt: new Date(clock() + 60_000).toISOString(), region }
    },
    async confirmVisual(id: string, reviewedBy: 'assistant' | 'operator') {
      if (reviewedBy !== 'assistant' && reviewedBy !== 'operator') throw Error('verification_review_source_invalid')
      const snapshot = snapshots.get(id)
      if (!snapshot || snapshot.mode !== 'visual') throw Error('verification_visual_snapshot_missing')
      await validate(snapshot, [], false)
      snapshots.set(id, Object.freeze({ ...snapshot, visualConfirmedAt: clock() }))
      return { snapshotId: id, visualConfirmedAt: new Date(clock()).toISOString(), reviewSource: `${reviewedBy}_reviewed_image`, actionLimit: 1 }
    },
    async act(id: string, action: { type: 'click'; at: Point } | { type: 'drag'; from: Point; to: Point }) {
      const snapshot = snapshots.get(id)
      if (!snapshot) throw Error('verification_snapshot_missing_or_used')
      snapshots.delete(id) // one action per snapshot, including failed actions
      const points = action.type === 'click' ? [action.at] : [action.from, action.to]
      await validate(snapshot, points)
      const absolute = (point: Point) => ({ x: snapshot.clip.x + point.x, y: snapshot.clip.y + point.y })
      const from = absolute(action.type === 'click' ? action.at : action.from)
      await page.mouse.move(from.x, from.y)
      try { await page.mouse.down(); if (action.type === 'drag') { const to = absolute(action.to); await page.mouse.move(to.x, to.y, { steps: 12 }) } }
      finally { await page.mouse.up() }
      return { action: action.type, snapshotId: id, at: new Date(clock()).toISOString(), outcome: 'verification_action_only' }
    },
    async solve(id: string) {
      if (!automation) throw Error('verification_solver_not_configured')
      const snapshot = snapshots.get(id)
      if (!snapshot) throw Error('verification_snapshot_missing_or_used')
      if (snapshot.mode !== 'dom') throw Error('verification_assets_unsupported')
      const enoughTime = () => { if (snapshot.createdAt + 60_000 - clock() < 50_000) throw Error('verification_snapshot_insufficient_lifetime') }
      enoughTime()
      await validate(snapshot) // before any paid createTask
      const assets = await automation.extract(page, snapshot.clip)
      if (!assets || assets.images.length !== 1 || assets.source !== 'provider_dom') throw Error('verification_assets_unsupported')
      const background = await loadImage(assets.background).catch(() => undefined)
      if (!background || background.width !== snapshot.clip.width || background.height !== snapshot.clip.height) throw Error('verification_asset_scale_unsupported')
      enoughTime()
      await validate(snapshot) // extraction may have changed the page or puzzle
      const solution = await automation.solver.solve(assets, id)
      const target = solution.coordinates[0]
      if (!target) throw Error('verification_solution_no_movement')
      return this.act(id, { type: 'drag', from: assets.images[0].from, to: target })
    },
  }
}

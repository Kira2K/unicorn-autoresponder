import { digest } from './content-identity.ts'
import { PostError, errorCode } from './errors.ts'
import { parseMemeConcept } from './meme-concept.ts'
import type { MemeInput, MemeServices, MemeState, MemeOptions } from './meme-types.ts'

export async function writeMeme(input: MemeInput, services: MemeServices, options: MemeOptions): Promise<MemeState> {
  const source = structuredClone(input)
  const sourceHash = digest(JSON.stringify([source.post, source.audience, source.forbiddenTopics]))
  const policyHash = digest(services.policy)
  const state: MemeState = structuredClone(options.checkpoint ?? { sourceHash, policyHash,
    assetId: digest(`meme:${options.id}:${sourceHash}`), status: 'pending', plannerCalls: 0, imageCalls: 0 })
  const save = () => options.onCheckpoint(structuredClone(state))
  const finish = async (status: MemeState['status'], code?: string) => {
    state.status = status; state.errorCode = code; await save(); return state
  }
  if (state.sourceHash !== sourceHash || state.policyHash !== policyHash) return finish('blocked', 'meme_source_changed')
  if (options.signal?.aborted) return finish('cancelled')
  if (['blocked', 'uncertain', 'cancelled'].includes(state.status)) return state
  if (['ready', 'rendering'].includes(state.status)) {
    const cached = await services.assets.get(state.assetId)
    if (cached && cached.asset.sourceHash === sourceHash && cached.asset.altText === state.concept?.altText) {
      state.asset = cached.asset
      return finish('ready')
    }
    return finish('uncertain', 'meme_image_result_unknown')
  }
  if (state.status === 'planning') return finish('uncertain', 'meme_plan_result_unknown')
  if (!services.enabled) throw new PostError('meme_generation_disabled')
  if (state.status === 'pending') {
    if (state.plannerCalls) return finish('uncertain', 'meme_plan_result_unknown')
    state.status = 'planning'; state.plannerCalls = 1
    await save()
    if (options.signal?.aborted) return finish('cancelled')
    let raw: unknown
    try { raw = await services.plan(source) }
    catch (error) { return finish(options.signal?.aborted ? 'cancelled' : 'uncertain', errorCode(error)) }
    if (options.signal?.aborted) return finish('cancelled')
    try {
      const result = parseMemeConcept(raw, source)
      if (result.status === 'blocked') {
        state.blockingReason = result.reason
        return finish('blocked', 'meme_policy_blocked')
      }
      state.concept = result.concept
    } catch (error) { return finish('blocked', errorCode(error)) }
    state.status = 'planned'
    await save()
  }
  if (!state.concept || state.imageCalls) return finish('uncertain', 'meme_image_result_unknown')
  if (options.signal?.aborted) return finish('cancelled')
  state.status = 'rendering'; state.imageCalls = 1
  await save()
  if (options.signal?.aborted) return finish('cancelled')
  let bytes: Uint8Array
  try { bytes = await services.render(state.concept.prompt, options.signal) }
  catch (error) { return finish(options.signal?.aborted ? 'cancelled' : 'uncertain', errorCode(error)) }
  try { state.asset = await services.assets.put(state.assetId, sourceHash, bytes, state.concept.altText) }
  catch (error) { return finish('blocked', errorCode(error)) }
  return finish(options.signal?.aborted ? 'cancelled' : 'ready')
}

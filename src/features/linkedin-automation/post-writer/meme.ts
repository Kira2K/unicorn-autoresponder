import { digest } from './content-identity.ts'
import { PostError, errorCode } from './errors.ts'
import { planMeme } from './meme-planning.ts'
import { checkMemeQuality } from './meme-quality.ts'
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
  if (['ready', 'rendering', 'reviewing'].includes(state.status)) {
    const cached = await services.assets.get(state.asset?.id ?? state.assetId)
    if (cached && cached.asset.sourceHash === sourceHash && cached.asset.altText === state.concept?.altText) {
      state.asset = cached.asset
      if (state.status === 'ready') return finish('ready')
      state.status = 'reviewing'
      return checkMemeQuality(source, services, state, save, options.signal)
    }
    return finish('uncertain', 'meme_image_result_unknown')
  }
  if (state.status === 'planning') return finish('uncertain', 'meme_plan_result_unknown')
  if (!services.enabled) throw new PostError('meme_generation_disabled')
  await planMeme(source, services, state, save, options.signal)
  if (state.status !== 'planned') return state
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
  if (options.signal?.aborted) return finish('cancelled')
  state.status = 'reviewing'
  await save()
  return checkMemeQuality(source, services, state, save, options.signal)
}

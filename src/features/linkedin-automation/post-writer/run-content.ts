import { contentHash, digest, normalized } from './content-identity.ts'
import { PostError } from './errors.ts'
import type { PostRun, History, PostMedia, ProviderPost } from './types.ts'
import type { MemeAssets } from './meme-types.ts'
export function runContentHash(run: Pick<PostRun, 'draft' | 'memeEnabled' | 'meme'>) {
  if (!run.draft) throw new PostError('post_content_missing')
  if (!run.memeEnabled) return contentHash(run.draft.text)
  if (run.meme?.status !== 'ready' || !run.meme.asset || !run.meme.concept) throw new PostError('meme_not_ready')
  return digest(JSON.stringify([normalized(run.draft.text), run.meme.asset.sha256, run.meme.asset.altText]))
}
export async function runImage(run: Pick<PostRun, 'memeEnabled' | 'meme'>, assets?: MemeAssets) {
  if (!run.memeEnabled) return
  if (run.meme?.status !== 'ready' || !run.meme.asset || !assets) throw new PostError('meme_not_ready')
  const image = await assets.get(run.meme.asset.id)
  if (!image || image.asset.sourceHash !== run.meme.sourceHash ||
    JSON.stringify(image.asset) !== JSON.stringify(run.meme.asset)) throw new PostError('meme_asset_changed')
  return image
}
export async function publicationMedia(run: PostRun, assets?: MemeAssets): Promise<PostMedia | undefined> {
  const image = await runImage(run, assets)
  return image && { content: image.content, content_type: 'image/png', filename: `${image.asset.sha256}.png` }
}
export function imageConfirmed(run: PostRun, post: ProviderPost) {
  if (!run.memeEnabled) return true
  const images = post.images
  return Boolean(run.postImageId && images?.length === 1 && images[0].id === run.postImageId && images[0].available)
}
export function runHistory(run: PostRun, status: History['status']): History {
  if (!run.hash || !run.draft || !run.topic) throw new PostError('post_content_missing')
  const concept = run.memeEnabled && run.meme?.concept
  return { id: `${run.account}-${run.hash}`, account: run.account, runId: run.id, hash: run.hash,
    text: run.draft.text, signature: run.topic.signature, status, postId: run.postId, url: run.url,
    publishedAt: run.publishedAt, ...(concept ? { meme: { scene: concept.scene,
      style: concept.style, captionLines: concept.captionLines } } : {}) }
}

import type { JsonFiles } from './json-files.ts'
import type { MemeAssets, MemeFile } from './meme-types.ts'
import { inspectMemeImage, MAX_MEME_BYTES } from './meme-image.ts'
import { createSerialQueue } from './serial.ts'
import { PostError } from './errors.ts'

export function createMemeAssets(files: JsonFiles): MemeAssets {
  const serial = createSerialQueue()
  const key = (id: string) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new PostError('meme_asset_invalid')
    return id
  }
  async function get(id: string): Promise<MemeFile | undefined> {
    const value = await files.get<MemeFile>('meme-assets', key(id))
    if (!value) return
    if (typeof value.content !== 'string' || value.content.length > MAX_MEME_BYTES * 1.4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.content)) throw new PostError('meme_asset_invalid')
    const inspected = inspectMemeImage(Buffer.from(value.content, 'base64'))
    if (value.asset.id !== id || inspected.sha256 !== value.asset.sha256 ||
      inspected.width !== value.asset.width || inspected.height !== value.asset.height ||
      inspected.byteLength !== value.asset.byteLength || value.asset.mimeType !== 'image/png') {
      throw new PostError('meme_asset_invalid')
    }
    return value
  }
  return { get, put: (id, sourceHash, bytes, altText) => serial(key(id), async () => {
    const asset = { id, sourceHash, altText, ...inspectMemeImage(bytes) }
    const previous = await get(id)
    if (previous) {
      if (JSON.stringify(previous.asset) !== JSON.stringify(asset)) throw new PostError('meme_asset_conflict')
      return previous.asset
    }
    const value: MemeFile = { asset, content: Buffer.from(bytes).toString('base64') }
    await files.put('meme-assets', id, value)
    const actual = await get(id)
    if (!actual || JSON.stringify(actual) !== JSON.stringify(value)) throw new PostError('meme_asset_readback_failed')
    return asset
  }) }
}

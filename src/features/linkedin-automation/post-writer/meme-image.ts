import { createHash } from 'node:crypto'
import { PostError } from './errors.ts'
export const MAX_MEME_BYTES = 8 * 1024 * 1024
export function inspectMemeImage(value: Uint8Array) {
  const bytes = Buffer.from(value)
  if (bytes.length < 57 || bytes.length > MAX_MEME_BYTES ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new PostError('meme_image_invalid')
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (width !== 1024 || height !== 1280) throw new PostError('meme_image_dimensions_invalid')
  let offset = 8, data = false, ended = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (length > bytes.length - offset - 12) throw new PostError('meme_image_invalid')
    data ||= kind === 'IDAT' && length > 0
    offset += length + 12
    if (kind === 'IEND') { ended = length === 0 && offset === bytes.length; break }
  }
  if (!data || !ended) throw new PostError('meme_image_invalid')
  return { width, height, byteLength: bytes.length, mimeType: 'image/png' as const,
    sha256: createHash('sha256').update(bytes).digest('hex') }
}

import { deflateSync } from 'node:zlib'
import { createMemeAssets } from './meme-assets.ts'
import { memoryJsonFiles } from './memory-json-files.ts'
import type { MemeServices } from './meme-types.ts'
// A valid deterministic PNG fixture; it tests delivery, not visual generation quality.
export function mockMemePng(red = 60) {
  function chunk(kind: string, data: Buffer) {
    const payload = Buffer.concat([Buffer.from(kind), data])
    let crc = 0xffffffff
    for (const byte of payload) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4), tail = Buffer.alloc(4)
    length.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, payload, tail])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1024); header.writeUInt32BE(1280, 4); header[8] = 8; header[9] = 2
  const rows = Buffer.alloc((1024 * 3 + 1) * 1280)
  for (let y = 0; y < 1280; y++) for (let x = 0; x < 1024; x++) {
    const offset = y * (1024 * 3 + 1) + 1 + x * 3
    rows[offset] = red; rows[offset + 1] = y < 640 ? 140 : 80; rows[offset + 2] = 180
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
export function createMockMemes(): MemeServices {
  const png = mockMemePng()
  return { enabled: true, policy: 'mock policy', assets: createMemeAssets(memoryJsonFiles()),
    async plan(input) { return { status: 'ready', reason: '', concept: {
      postAnchor: input.post.slice(0, 30), scene: 'Mock delivery fixture', style: 'Mock diagram',
      captionLines: [], prompt: 'Mock diagram 4:5 1024x1280; no lettering.',
      altText: 'Two blue blocks: mock image fixture, not generated content.' } } },
    async render() { return png } }
}

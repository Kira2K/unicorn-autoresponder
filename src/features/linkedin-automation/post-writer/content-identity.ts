import { createHash } from 'node:crypto'

export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim()
export const contentHash = (text: string) => digest(normalized(text))

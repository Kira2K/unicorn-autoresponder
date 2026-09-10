import { mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Log } from './types.ts'

export function createPostLogger(directory = 'logs/linkedin-posts'): Log {
  return (event, fields = {}) => {
    try {
      mkdirSync(directory, { recursive: true })
      appendFileSync(join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`),
        JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + '\n')
    } catch { /* Logging must not alter a confirmed mutation outcome. */ }
  }
}

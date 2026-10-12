import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import type { Source } from '../types.ts'

export async function readSources(input: { entries?: (Source | string)[]; path?: string }): Promise<Source[]> {
  const entries: Source[] = (input.entries ?? []).map(v => typeof v === 'string' ? { name: new URL(v).hostname, url: v } : v)
  if (input.path) {
    if ((await stat(input.path)).isDirectory()) {
      for (const name of (await readdir(input.path)).sort()) {
        const path = join(input.path, name)
        if ((await stat(path)).isFile() && /\.(txt|md|json|csv)$/i.test(name)) entries.push(...await readSources({ path }))
      }
    } else {
      const body = await readFile(input.path, 'utf8')
      if (extname(input.path).toLowerCase() === '.json') {
        const parsed = JSON.parse(body)
        entries.push(...await readSources({ entries: Array.isArray(parsed) ? parsed : parsed.sources }))
      } else {
        for (const [index, line] of body.split(/\r?\n/).entries()) {
          for (const url of line.match(/https?:\/\/[^\s<>"),|]+/g) ?? []) entries.push({ name: line.split(/[,|]/).find(x => x.trim() && !/^\d+$/.test(x.trim()) && !x.includes('http'))?.trim() ?? new URL(url).hostname, url, provenance: `${input.path}:line ${index + 1}` })
        }
      }
    }
  }
  const seen = new Set<string>()
  return entries.filter(entry => {
    const url = new URL(entry.url)
    if (!['https:', 'http:'].includes(url.protocol)) throw Error('Only HTTP(S) URLs are supported')
    if (seen.has(url.href)) return false
    seen.add(url.href); return true
  })
}

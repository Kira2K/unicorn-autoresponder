import type { JsonFiles } from './json-files.ts'
export function memoryJsonFiles(): JsonFiles {
  const rows = new Map<string, unknown>()
  return {
    async get<T>(bucket: string, key: string) { return structuredClone(rows.get(`${bucket}:${key}`)) as T | undefined },
    async put(bucket, key, value) { rows.set(`${bucket}:${key}`, structuredClone(value)) },
    async list<T>(bucket: string) {
      return [...rows].filter(([key]) => key.startsWith(`${bucket}:`)).map(([, value]) => structuredClone(value) as T)
    }
  }
}

import type { History, PostStore, Tables } from './types.ts'

export function createMemoryPostStore(): PostStore {
  const tables = { settings: new Map(), runs: new Map(), history: new Map() } as {
    [K in keyof Tables]: Map<string, Tables[K]>
  }
  return {
    async list<K extends keyof Tables>(table: K, account?: number) {
      return structuredClone([...tables[table].values()].filter(row =>
        account === undefined || row.account === account)) as Tables[K][]
    },
    async get<K extends keyof Tables>(table: K, key: string) {
      return structuredClone(tables[table].get(key)) as Tables[K] | undefined
    },
    async put<K extends keyof Tables>(table: K, key: string, value: Tables[K]) {
      (tables[table] as Map<string, Tables[K]>).set(key, structuredClone(value))
    },
    async claim(key: string, value: History) {
      const existing = tables.history.get(key)
      if (!existing) tables.history.set(key, structuredClone(value))
      return { value: structuredClone(existing ?? value), created: !existing }
    }
  }
}

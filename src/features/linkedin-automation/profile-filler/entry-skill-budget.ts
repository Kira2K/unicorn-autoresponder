import type { JsonObject } from './input-types.ts'
import { MCP_PROFILE_SKILLS_LIMIT } from './mcp-contract.ts'
import { name, section } from './profile-data.ts'

export type EntrySkillBudget = ReturnType<typeof createEntrySkillBudget>

export function createEntrySkillBudget(profile: JsonObject) {
  const occupied = new Set(section(profile, 'skills').map(name).filter(Boolean)
    .map(value => value!.toLowerCase()))
  return {
    take(requested: string[]) {
      const accepted: string[] = []
      const blocked: string[] = []
      for (const value of requested) {
        const key = value.trim().toLowerCase()
        if (!key || accepted.some(item => item.toLowerCase() === key)) continue
        if (occupied.has(key)) { accepted.push(value); continue }
        if (occupied.size >= MCP_PROFILE_SKILLS_LIMIT) { blocked.push(value); continue }
        occupied.add(key); accepted.push(value)
      }
      return { accepted, blocked }
    }
  }
}

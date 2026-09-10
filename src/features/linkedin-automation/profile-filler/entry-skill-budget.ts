import type { JsonObject } from './input-types.ts'
import { MCP_PROFILE_SKILLS_LIMIT } from './mcp-contract.ts'
import { name, section } from './profile-data.ts'

export type EntrySkillBudget = ReturnType<typeof createEntrySkillBudget>

const skillKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

export function createEntrySkillBudget(profile: JsonObject) {
  const occupied = new Set(section(profile, 'skills').map(name).filter(Boolean)
    .map(value => skillKey(value!)))
  return {
    take(requested: string[]) {
      const accepted: string[] = []
      const blocked: string[] = []
      for (const value of requested) {
        const key = skillKey(value)
        if (!key || accepted.some(item => skillKey(item) === key)) continue
        if (occupied.has(key)) { accepted.push(value); continue }
        if (occupied.size >= MCP_PROFILE_SKILLS_LIMIT) { blocked.push(value); continue }
        occupied.add(key); accepted.push(value)
      }
      return { accepted, blocked }
    }
  }
}

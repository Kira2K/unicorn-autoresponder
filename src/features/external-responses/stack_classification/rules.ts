import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { digest } from '../../company-client-management/legacy-snapshot.mts'

export type SelectionRules = { version: 1; source: string; text: string; sha256: string }
export const selectionRulesPath = fileURLToPath(new URL('../../../../.agents/skills/vacancy-selection/SKILL.md', import.meta.url))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** The existing Rules heading is the authoring boundary. Legacy custom files retain all text. */
export function semanticRules(value: SelectionRules): string {
  assertSelectionRules(value)
  const section = /^## Rules\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(value.text)
  if (!section) return value.text
  const text = section[1].trim()
  if (!text) throw Error('semantic_selection_rules_empty')
  return text
}

/** Canonical machine policy is retained in compatibility, not repeated as model instructions. */
export function decisionRulesHash(value: SelectionRules): string {
  const checks = [...value.text.matchAll(/```([a-z-]+-precheck-json)\s*\n([\s\S]*?)```/g)]
    .map(match => ({ kind: match[1], policy: JSON.parse(match[2]) })).sort((a,b)=>a.kind.localeCompare(b.kind))
  return digest({ version: 1, semantic: semanticRules(value), checks })
}

/** Read editable Markdown once per classification; comments/frontmatter are not decision rules. */
export async function loadSelectionRules(path = selectionRulesPath): Promise<SelectionRules> {
  const markdown = await readFile(path, 'utf8')
  const text = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').replace(/<!--[\s\S]*?-->/g, '').trim()
  const value: SelectionRules = { version: 1, source: path, text, sha256: hash(text) }
  assertSelectionRules(value)
  return value
}

export function assertSelectionRules(value: SelectionRules) {
  if (!value || value.version !== 1 || !value.source?.trim() || !value.text?.trim() || value.sha256 !== hash(value.text)) throw Error('vacancy_selection_rules_invalid')
}

export function assertCurrentSelectionRules(saved: SelectionRules | undefined, current: SelectionRules) {
  assertSelectionRules(current)
  if (!saved) throw Error('vacancy_selection_rules_required: classify with the selection skill first')
  assertSelectionRules(saved)
  if (decisionRulesHash(saved) !== decisionRulesHash(current)) throw Error('vacancy_selection_rules_changed: use a new classification run before matching or applying')
}

import assert from 'node:assert/strict'
import { assertCompleteSkills, orderedSkillCandidates, requiredSkillSet } from '../skill-selection.ts'

export function runSkillSelectionTests() {
  const cv = { skillGroups: [
    { items: ['Python', 'Bash', 'FastAPI'] },
    { items: ['PostgreSQL', 'Redis'] },
    { items: ['Docker', ' python ', 'Kubernetes'] }
  ], skills: ['PYTHON', 'Grafana'], experience: [{ technologies: ['Jira', 'Redis'] }] } as any
  assert.deepEqual(orderedSkillCandidates(cv),
    ['Python', 'PostgreSQL', 'Docker', 'Bash', 'Redis', 'FastAPI', 'Kubernetes', 'Grafana', 'Jira'])
  assert.throws(() => requiredSkillSet(cv), { code: 'profile_hh_skills_source_insufficient' })
  const expected = requiredSkillSet({ skillGroups: [],
    skills: Array.from({ length: 40 }, (_, index) => `Skill ${index}`), experience: [] })
  assert.equal(expected.length, 30)
  const saved = expected.map(name => ({ name, level: 'advanced' }))
  assert.doesNotThrow(() => assertCompleteSkills(saved, expected))
  for (const incomplete of [[], saved.slice(0, 29), [...saved.slice(0, 29), saved[0]],
    saved.map((item, index) => index === 0 ? { ...item, level: null } : item),
    saved.map((item, index) => index === 0 ? { ...item, level: 'basic' } : item),
    saved.map((item, index) => index === 0 ? { ...item, name: 'Unrelated' } : item)]) {
    assert.throws(() => assertCompleteSkills(incomplete, expected), { code: 'profile_hh_skills_incomplete' })
  }
}

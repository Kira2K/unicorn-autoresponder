export type StackProfile = {
  id: string; name: string; databaseId?: string; description?: string
  seniorities?: string[]; roleTerms?: string[]; technologyGroups?: string[][]
  excludedTitleTerms?: string[]; notes?: string
}
export const javaStack: StackProfile = {
  id: 'java', name: 'Java', seniorities: ['middle', 'senior'], roleTerms: ['backend', 'back-end', 'back end'],
  technologyGroups: [['Java'], ['Spring', 'Spring Boot', 'Spring Framework']],
  excludedTitleTerms: ['QA', 'test', 'automation', 'Android', 'frontend', 'fullstack', 'full-stack', 'full stack', 'architect', 'manager', 'lead', 'staff', 'principal'],
  notes: 'Confirmed scope: middle/senior backend positions using Java and Spring. Missing responsibility or framework evidence needs review.'
}
export function validateStackProfiles(stacks: StackProfile[]): string[] {
  const issues: string[] = [], ids = new Set<string>()
  if (!Array.isArray(stacks) || !stacks.length) return ['At least one explicit stack profile is required']
  for (const stack of stacks) {
    if (!stack || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(stack.id ?? '')) { issues.push('Invalid stack identifier'); continue }
    if (ids.has(stack.id)) issues.push(`${stack.id}: duplicate stack identifier`); ids.add(stack.id)
    if (!stack.name?.trim()) issues.push(`${stack.id}: name required`)
    if (stack.description?.trim()) continue
    if (!stack.seniorities?.length || stack.seniorities.some(value => !['intern', 'graduate', 'junior', 'middle', 'senior', 'lead', 'staff', 'principal', 'manager', 'head'].includes(value))) issues.push(`${stack.id}: allowed seniorities required`)
    if (!stack.roleTerms?.length || stack.roleTerms.some(value => !value.trim())) issues.push(`${stack.id}: role terms required`)
    if (!stack.technologyGroups?.length || stack.technologyGroups.some(group => !group.length || group.some(value => !value.trim()))) issues.push(`${stack.id}: required technology groups required`)
  }
  return issues
}

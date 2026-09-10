const array = value => Array.isArray(value) ? value : []
const key = value => String(value).normalize('NFKC').trim().toLowerCase()
export function skillSummary(steps = []) {
  const skills = steps.filter(step => step.section === 'skills')
  const counts = skills.map(step => step.before?.count).filter(Number.isFinite)
  const targets = skills.map(step => step.after?.count).filter(Number.isFinite)
  const added = [...new Map(skills.flatMap(step => array(step.after?.added))
    .map(name => [key(name), name])).values()]
  return { existing: counts.length ? Math.min(...counts) : null,
    target: targets.length ? Math.max(...targets) : null, added }
}
export function previewSummary(preview) {
  const steps = preview?.steps || []
  const profile = preview?.document?.profile
  const blocked = section => {
    const paths = [...(preview?.skippedChanges || []), ...(preview?.issues || [])
      .filter(issue => issue.level === 'fatal').map(issue => issue.path || '')]
    const base = `profile.${section}`
    if (paths.includes(base)) return Array.isArray(profile?.[section]) ? profile[section].length : 1
    return new Set(paths.filter(path => path.startsWith(`${base}[`))
      .map(path => path.match(/\[\d+\]/)?.[0]).filter(Boolean)).size
  }
  const entries = section => ({
    total: Array.isArray(profile?.[section]) ? profile[section].length : null,
    created: steps.filter(step => step.section === section && step.action === 'create').length,
    updated: steps.filter(step => step.section === section && step.action === 'update').length,
    blocked: blocked(section)
  })
  return { experience: entries('experience'), education: entries('education'), skills: skillSummary(steps) }
}
export function previewGroups(preview) {
  return ['headline', 'about', 'experience', 'education', 'skills', 'open_to_work'].map(section => ({
    section, steps: (preview?.steps || []).filter(step => step.section === section)
  })).filter(group => group.steps.length || Object.hasOwn(preview?.document?.profile || {}, group.section) ||
    (preview?.issues || []).some(issue => issue.path === `profile.${group.section}` ||
      issue.path?.startsWith(`profile.${group.section}.`) || issue.path?.startsWith(`profile.${group.section}[`)))
}
export const omittedSkills = issues => (issues || []).filter(issue => issue.path === 'profile.skills.omitted')

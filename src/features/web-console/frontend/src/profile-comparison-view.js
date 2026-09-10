import { previewGroups } from './profile-preview-view.js'
import { profileFieldStatuses, fieldDisplayStatus } from './profile-field-status.js'
export const aggregateFieldStatus = fields => fields.includes('blocker') ? 'blocker' : fields.includes('warning') ? 'warning'
  : fields.length && fields.every(status => status === 'excluded') ? 'excluded' : 'ready'
export const fieldStatusLabel = status => ({ blocker: 'Блокер', warning: 'Есть замечания', ready: 'Готово', excluded: 'Не заполнять' })[status]
const covers = (parent, child = '') => child === parent || child.startsWith(`${parent}.`) || child.startsWith(`${parent}[`)
export function comparisonGroups(preview, result, editor) {
  return previewGroups(preview).map(group => {
    const fields = profileFieldStatuses(preview, group.section, result)
    const indexed = ['experience', 'education'].includes(group.section)
    const numbers = indexed ? [...new Set(fields.map(field => field.record))] : [undefined]
    const entries = numbers.map(record => {
      const selected = fields.filter(field => field.record === record)
      const step = group.steps.find(step => indexed ? step.id === `${group.section}-${record}` : true)
      const beforeKey = indexed ? `${group.section}-${record}` : group.section
      return { id: `${group.section}-${record ?? 'field'}`, record, fields: selected,
        before: step ? step.before : preview.currentValues?.[beforeKey], after: step?.after,
        action: step?.action, status: aggregateFieldStatus(selected.map(field => fieldDisplayStatus(field, editor))) }
    })
    // Older jobs may have only steps, without the editable source document. Keep every saved comparison.
    if (!fields.length) entries.splice(0, entries.length, ...group.steps.map((step, index) => ({
      id: step.id, record: indexed ? index + 1 : undefined, fields: [], before: step.before, after: step.after,
      action: step.action, status: result?.steps?.some(item => item.stepId === step.id && item.status !== 'verified') ? 'warning' : 'ready'
    })))
    const issues = (preview.issues || []).filter(issue => covers(`profile.${group.section}`, issue.path) &&
      (issue.autoFixed || !fields.some(field => covers(field.path, issue.path))))
    const counts = { added: group.steps.filter(step => step.action === 'create').length,
      changed: group.steps.filter(step => step.action === 'update').length }
    const skipped = (preview.skippedChanges || []).filter(path => covers(`profile.${group.section}`, path))
    const path = `profile.${group.section}`
    const enabled = !(preview.disabledFields || []).includes(path) && (!fields.length || fields.some(field => field.enabled))
    return { ...group, path, enabled, entries, issues, counts, skipped, status: !enabled ? 'excluded' : aggregateFieldStatus([
      ...entries.map(entry => entry.status), ...issues.map(issue => issue.level === 'fatal' ? 'blocker' : 'warning'),
      ...(skipped.length ? ['warning'] : [])]) }
  })
}

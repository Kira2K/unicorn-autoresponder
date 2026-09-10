import { profileRows, profileValue } from './profile-value-view.js'
import { profileSection } from './profile-workflow-view.js'
import { issueMessage, issueResolution } from './profile-issue-view.js'
import { editableFields } from '../../../linkedin-automation/profile-filler/editable-fields.ts'
import { fieldDisabled } from '../../../linkedin-automation/profile-filler/field-selection.ts'

const covers = (parent, child) => parent === child || child.startsWith(`${parent}.`) || child.startsWith(`${parent}[`)
const related = (a, b) => covers(a, b) || covers(b, a)
export function profileFieldStatuses(preview, section, result) {
  const profile = preview?.document?.profile
  if (!profile || !Object.hasOwn(profile, section)) return []
  const entries = ['experience', 'education'].includes(section)
    ? (profile[section] || []).map((entry, index) => ({ path: `profile.${section}[${index}].data`,
      unit: `profile.${section}[${index}]`, value: entry.data || entry, index }))
    : [{ path: `profile.${section}`, unit: `profile.${section}`, value: profile[section] }]
  const issues = preview.issues || []
  return entries.flatMap(entry => {
    const fields = ['headline', 'about', 'skills'].includes(section)
      ? [{ key: section === 'skills' ? 'add' : '', label: profileSection(section), value: profileValue(section === 'skills' ? entry.value?.add : entry.value) }]
      : profileRows(Object.fromEntries((editableFields[section] || []).map(key => [key, entry.value?.[key]])))
    for (const issue of issues.filter(issue => covers(entry.path, issue.path))) {
      const key = issue.path.slice(entry.path.length + 1).split(/[.[]/)[0]
      if (key && !fields.some(field => field.key === key)) fields.push(...profileRows({ [key]: undefined }))
    }
    const step = (preview.steps || []).find(step => entry.index === undefined
      ? step.section === section : step.id === `${section}-${entry.index + 1}`)
    const sent = step && result?.steps?.filter(item => item.section === section &&
      (entry.index === undefined || item.stepId === step.id))
    return fields.map(field => {
      const path = field.key ? `${entry.path}.${field.key}` : entry.path
      const own = issues.filter(issue => related(issue.path || 'profile', path) && !issue.autoFixed)
      const blockedUnit = issues.filter(issue => issue.level === 'fatal' &&
        (covers(entry.unit, issue.path) || covers(issue.path || 'profile', entry.unit)))
      const skipped = (preview.skippedChanges || []).some(unit => related(unit, entry.unit))
      const blockers = own.filter(issue => issue.level === 'fatal')
      const enabled = !fieldDisabled(preview.disabledFields || [], path)
      const status = !enabled ? 'excluded' : blockers.length ? 'blocker' :
        blockedUnit.length || skipped || own.length || (result && sent?.some(item => item.status !== 'verified')) ? 'warning' : 'ready'
      const comments = [...new Set(own.filter(issue => covers(path, issue.path)).map(issue =>
        `${issueMessage(issue)} ${issueResolution(issue)}`.trim()))]
      if (result && sent?.some(item => item.status !== 'verified')) comments.push('Результат ещё не подтверждён.')
      return { ...field, path, record: entry.index === undefined ? undefined : entry.index + 1,
        issues: own.filter(issue => covers(path, issue.path)),
        section, inputKey: field.key || section, raw: field.key ? entry.value?.[field.key] : entry.value,
        manuallyEdited: (preview.editedFields || []).includes(path),
        enabled, status, labelStatus: { ready: 'Готово', warning: 'Есть замечания', blocker: 'Блокер', excluded: 'Не заполнять' }[status], comments }
    })
  })
}
export function fieldDisplayStatus(field, editor) {
  if (field.enabled === false) return 'excluded'
  if (editor?.issues.value[field.path]?.length) return 'blocker'
  return editor && Object.hasOwn(editor.values.value, field.path) ? 'warning' : field.status
}

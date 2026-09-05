import { profileSection } from './profile-workflow-view.js'
export const stepLabels = {
  pending: 'Ожидает очереди', waiting: 'Пауза перед отправкой', writing: 'Отправляем',
  write_accepted: 'Принято, проверяем', verifying: 'Проверяем в LinkedIn',
  verification_delayed: 'Ожидаем подтверждения LinkedIn', pending_retry: 'Не применено',
  verified: 'Подтверждено', failed: 'Нужна проверка'
}
export function progressSteps(result, previewSteps = []) {
  const saved = new Map((result?.steps || []).map(step => [step.stepId, step]))
  const planned = previewSteps.map(step => saved.get(step.id) || {
    stepId: step.id, section: step.section, status: 'pending'
  })
  return [...planned, ...(result?.steps || []).filter(step => !previewSteps.some(plan => plan.id === step.stepId))]
}
export function progressGroups(result, previewSteps) {
  const groups = new Map()
  for (const step of progressSteps(result, previewSteps)) {
    if (!groups.has(step.section)) groups.set(step.section, [])
    groups.get(step.section).push(step)
  }
  const priority = ['failed', 'verification_delayed', 'writing', 'write_accepted',
    'verifying', 'waiting', 'pending_retry', 'pending', 'verified']
  return [...groups].map(([section, steps]) => {
    const status = priority.find(value => steps.some(step => step.status === value))
    return { section, name: profileSection(section), steps, status,
      complete: steps.filter(step => step.status === 'verified').length,
      confirmed: steps.every(step => step.status === 'verified'), label: stepLabels[status] || 'Нет данных' }
  })
}

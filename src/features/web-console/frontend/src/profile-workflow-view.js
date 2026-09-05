export const profileSections = {
  headline: 'Заголовок', about: 'О себе', experience: 'Опыт работы',
  education: 'Образование', skills: 'Навыки', open_to_work: 'Готовность к работе'
}
const activeStatuses = new Set(['generating_cv', 'generating_profile', 'validating',
  'previewing', 'retrying', 'running', 'verifying'])
export const isProfileActive = job => activeStatuses.has(job?.status)
export const profileSection = section => profileSections[section] || 'Раздел профиля'
export function profileStage(job) {
  if (!job) return 0
  if (['running', 'verifying'].includes(job.status)) return 2
  if (['succeeded', 'failed', 'needs_expert_review', 'pending_verification'].includes(job.status)) return 3
  return 1
}
export function profileStatus(job) {
  if (job?.phase === 'partially_completed') return 'Заполнен частично'
  return ({ generating_cv: 'Читаем CV', generating_profile: 'Готовим тексты',
    validating: 'Проверяем данные', previewing: 'Сравниваем с LinkedIn',
    waiting_retry: 'Нужно продолжить подготовку', retrying: 'Ожидаем повторной попытки',
    preview_ready: 'Изменения готовы к проверке', running: 'Заполняем профиль',
    verifying: 'Проверяем изменения в LinkedIn', succeeded: 'Профиль заполнен и проверен',
    failed: 'Выполнение остановлено', needs_expert_review: 'Нужна проверка',
    pending_verification: 'Результат старого задания не подтверждён'
  })[job?.status] || 'Подготовка профиля'
}
export function profileLink(account, job) {
  const value = job?.preview?.identity?.profileUrl || account?.linkedinUrl
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(url.hostname) ? url.href : ''
  } catch { return '' }
}
export function profileDate(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU') : 'Нет данных'
}

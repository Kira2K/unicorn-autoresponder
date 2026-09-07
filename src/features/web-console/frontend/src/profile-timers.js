export function duration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].filter((_, index) => hours || index > 0)
    .map(value => String(value).padStart(2, '0')).join(':')
}

export function overallTime(result, now) {
  if (!result.startedAt) return ''
  const end = result.finishedAt ? Date.parse(result.finishedAt) : now
  return duration(end - Date.parse(result.startedAt))
}

export function stepTimer(step, resultStatus, now) {
  const active = ['running', 'verifying'].includes(resultStatus)
  if (['verified', 'verification_delayed', 'pending_retry', 'pending'].includes(step.status)) return ''
  if (step.nextActionAt && active) {
    const remaining = Date.parse(step.nextActionAt) - now
    const action = step.status === 'waiting' ? 'Отправка' : 'Проверка'
    return remaining > 0 ? `${action} через ${duration(remaining)}` : `${action}: ожидаем обновления статуса`
  }
  if (step.status === 'failed' && step.durationMs !== undefined) {
    return `Остановлено через ${duration(step.durationMs)}`
  }
  if (step.updatedAt && active) {
    return `В этом состоянии ${duration(now - Date.parse(step.updatedAt))}`
  }
  return ''
}

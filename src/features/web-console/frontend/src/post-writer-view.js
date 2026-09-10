export const stages = { queued: 'В очереди', generating: 'Готовим пост', awaiting_approval: 'Ждёт подтверждения',
  ready: 'Готов к публикации', publishing: 'Публикуем', verifying: 'Проверяем публикацию',
  uncertain: 'Выясняем результат публикации', published: 'Пост опубликован', blocked: 'Нужна проверка',
  stopped: 'Остановлено', rejected: 'Отклонено' }
export const engagementLabels = { off: 'Выключены', pending: 'Готовим лайки', running: 'Ставим лайки',
  uncertain: 'Проверяем результат лайка', partial: 'Выполнены частично', completed: 'Завершены', cancelled: 'Отменены' }
export const runActive = run => run && !['blocked', 'stopped', 'rejected'].includes(run.status) &&
  (run.status !== 'published' || ['pending', 'running', 'uncertain'].includes(run.engagement.status))
export const dateMsk = value => value ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow',
  dateStyle: 'short', timeStyle: 'short' }).format(value) + ' МСК' : '—'
export const countdown = (at, now) => {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

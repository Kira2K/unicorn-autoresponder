export const featureNames = { invitations: 'Приглашения', posts: 'Посты', comments: 'Комментарии', withdrawals: 'Отзыв приглашений', likes: 'Лайки' }
export const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const stateNames = { planned: 'Запланировано', running: 'Выполняется', waiting: 'Ожидание', verifying: 'Проверяем отправленное', completed: 'Завершено', stopped: 'Остановлено', needs_attention: 'Нужно внимание' }
export const connectionNames = { connected: 'Подключён', attention: 'Нужно внимание', error: 'Ошибка подключения', not_connected: 'Не подключён' }
export const dateMsk = value => Number.isFinite(Number(value)) && Number(value) > 0
  ? new Date(Number(value)).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
export const timeText = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
export function timeMinutes(value) {
  if (value === '24:00') return 1440
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
}
export function scheduleDraft(schedule) {
  return { enabled: schedule?.enabled ?? false, version: schedule?.version ?? 0,
    postPolicy: schedule?.postPolicy ? { ...schedule.postPolicy } : undefined,
    slots: (schedule?.slots ?? []).map(s => ({ ...s, start: timeText(s.start), end: timeText(s.end), features: [...s.features] })) }
}
export function schedulePayload(draft) {
  return { enabled: draft.enabled, version: draft.version,
    ...(draft.postPolicy ? { postPolicy: { ...draft.postPolicy } } : {}),
    slots: draft.slots.map(s => ({ ...s, start: timeMinutes(s.start), end: timeMinutes(s.end), features: [...s.features] })) }
}
export function scheduleError(draft) {
  if (draft.slots.length > 70) return 'В расписании может быть не больше 70 интервалов.'
  if (draft.enabled && !draft.slots.length) return 'Добавьте хотя бы один интервал.'
  for (const s of draft.slots) {
    const start = timeMinutes(s.start), end = timeMinutes(s.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Введите полное время: например, 10:00 и 15:00.'
    if (start >= end) return 'Время «До» должно быть позже «С». Ночной интервал разделите на два.'
    if (!s.features.length) return 'Выберите хотя бы одну фичу в каждом интервале.'
  }
  for (let day = 0; day < 7; day++) {
    const slots = draft.slots.filter(s => s.day === day).sort((a, b) => timeMinutes(a.start) - timeMinutes(b.start))
    if (slots.some((s, i) => i > 0 && timeMinutes(s.start) < timeMinutes(slots[i - 1].end))) return `Пересекаются интервалы: ${weekDays[day]}.`
  }
  return ''
}
export function reasonText(code) {
  const messages = {
    unipile_action_skipped: 'Действие пропущено после 20 минут ошибок сервиса. Остальные действия продолжаются.',
    comments_post_skipped: 'Комментарии пропущены: публикацию не удалось подтвердить после ошибки сервиса.',
    history_and_quota_saved: 'История проверена, дневная норма сохранена.',
    action_pause: 'Пауза между действиями фич.', generating_or_waiting: 'Готовим текст; аккаунт доступен другим фичам.',
    automation_window_missed: 'Запуск пропущен: разрешённый интервал закончился.',
    session_continued: 'Эту сессию продолжает задача следующего дня.',
    candidate_page_saved: 'Порция кандидатов сохранена.', candidate_result_saved: 'Результат обработки кандидата сохранён.',
    candidate_skipped: 'Кандидат пропущен по условиям отбора.', withdrawal_saved: 'Результат отзыва сохранён.',
    saved_pause: 'Ожидаем окончания сохранённой паузы.', withdrawal_pacing: 'Пауза между отзывами приглашений.',
    session_limit: 'Лимит ответов достигнут. Ожидаем окончания текущей сессии.',
    session_finished: 'Сессия завершена. Ожидаем следующую проверку.',
    active_day_finished: 'День мониторинга завершён. Сессия сохранена.',
    comments_post_not_published: 'Комментарии не запущены: пост не опубликован до конца дня.',
    comments_not_started: 'Монитор комментариев в этот день не запускался.',
    unipile_provider_invalid_authorization: 'Подключение LinkedIn недействительно. Переподключите аккаунт.',
    post_account_not_ready: 'Аккаунт LinkedIn недоступен для публикации. Проверьте подключение.',
    automation_version_conflict: 'Расписание изменено в другом окне. Обновите сохранённую версию перед повторным сохранением.',
    automation_slot_invalid: 'Проверьте время и выбранные фичи интервала.', automation_slots_overlap: 'Интервалы одного дня пересекаются.',
    automation_schedule_invalid: 'Проверьте расписание.', automation_account_unverified: 'Сначала подключите и проверьте LinkedIn-аккаунт.',
    automation_resume_invalid: 'Продолжение сейчас недоступно. Обновите состояние.', automation_owner_lost: 'Исполнитель потерял доступ. Новые отправки приостановлены.',
    automation_unavailable: 'Автоматизация не подключена на этом backend.', automation_disabled: 'Автоматизация выключена.',
    automation_deadline_exceeded: 'Достигнут лимит времени задачи.', waiting_for_post: 'Комментарии ждут подтверждённый пост.',
    awaiting_post: 'Комментарии ждут подтверждённый пост.', linkedin_operation_active: 'Аккаунт занят другой фичей.',
    automation_window_closed: 'Ожидаем следующий разрешённый интервал.', post_prepared_missing: 'На эту дату нет готового поста.',
    outside_slot: 'Ожидаем следующий разрешённый интервал.', waiting_for_publication: 'Комментарии ждут подтверждённый пост.',
    connection_inviter_stack_required: 'Выберите стек для поиска кандидатов.'
  }
  if (!code) return ''
  if (messages[code]) return messages[code]
  if (/cooldown|rate_limit|429/.test(code)) return 'Ожидаем снятия ограничения Unipile.'
  if (/uncertain|verification|pending_verification/.test(code)) return 'Проверяем результат отправки. Повторной отправки нет.'
  if (/storage|persistence|postgres|sql_/.test(code)) return 'Нет доступа к сохранённому состоянию. Новые отправки приостановлены.'
  if (/timeout|unavailable|http_5/.test(code)) return 'Сервис не ответил. Смотрите журнал и срок следующей проверки.'
  return `Нужна проверка: ${code}`
}
export const apiError = error => reasonText(error?.body?.code || error?.body?.error) || error?.message || 'Не удалось выполнить действие.'
export const pendingTask = task => !['completed', 'stopped', 'needs_attention'].includes(task.state)
export function canResumeTask(task, schedule, now = Date.now()) {
  return !!schedule?.enabled && (['stopped', 'needs_attention'].includes(task.state) || (!!task.stopped && task.state === 'verifying')) &&
    task.day === new Date(now + 3 * 3600_000).toISOString().slice(0, 10) &&
    (!task.deadlineAt || task.deadlineAt > now) && task.activeMs < task.activeLimitMs &&
    schedule.slots.some(slot => slot.features.includes(task.feature))
}
export function nextWindow(schedule, now = Date.now()) {
  if (!schedule?.enabled || !schedule.slots.length) return undefined
  const date = new Date(now + 3 * 3600_000).toISOString().slice(0, 10)
  const midnight = Date.parse(`${date}T00:00:00+03:00`)
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
  for (let offset = 0; offset < 8; offset++) {
    const slots = schedule.slots.filter(s => s.day === (weekday + offset) % 7).sort((a, b) => a.start - b.start)
    for (const slot of slots) if (midnight + offset * 86400_000 + slot.end * 60_000 > now)
      return Math.max(now, midnight + offset * 86400_000 + slot.start * 60_000)
  }
}
export function accountSummary(account, status) {
  const schedule = status?.schedules?.find(s => s.account.id === account.platformAccountId)
  const tasks = (status?.tasks ?? []).filter(t => t.account.id === account.platformAccountId)
  const current = tasks.filter(pendingTask).sort((a, b) => (a.state === 'running' ? -1 : b.state === 'running' ? 1 :
    (a.effectiveNextAt ?? a.nextAt) - (b.effectiveNextAt ?? b.nextAt)))[0]
  const last = tasks.filter(t => !pendingTask(t)).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const attention = tasks.some(t => t.state === 'needs_attention') || ['attention', 'error'].includes(account.state)
  return { schedule, tasks, current, last, attention, features: [...new Set((schedule?.slots ?? []).flatMap(s => s.features))] }
}
export function isErrorEvent(event) {
  if (['comments_post_not_published', 'comments_not_started', 'post_account_not_ready', 'unipile_action_skipped', 'comments_post_skipped'].includes(event.code)) return true
  return event.httpStatus >= 400 || /error|failed|blocked|lost|uncertain|needs_attention|unavailable|timeout|invalid|conflict/.test(event.code)
}

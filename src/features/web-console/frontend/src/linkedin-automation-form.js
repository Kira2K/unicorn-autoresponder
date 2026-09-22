// UI input convenience only; the backend remains the authority on schedules.
export function normalizeSlotTime(value, endOfDay = false) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return undefined
  const hours = Number(match[1]), minutes = Number(match[2] || 0)
  if (minutes > 59 || hours > 24 || (hours === 24 && (!endOfDay || minutes !== 0))) return undefined
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function normalizeAutomationDraft(draft) {
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const slots = draft.slots.map(slot => {
    const start = normalizeSlotTime(slot.start), end = normalizeSlotTime(slot.end, true)
    const day = days[slot.day - 1] || 'Слот'
    if (!start) throw Error(`${day}: укажи время «С», например 09:00.`)
    if (!end) throw Error(`${day}: укажи время «До», например 12:00. Конец дня — 24:00.`)
    if (end <= start) throw Error(`${day}: время «До» должно быть позже времени «С». Ночной интервал раздели на два дня.`)
    return { ...slot, start, end, features: [...slot.features] }
  })
  return { ...draft, slots }
}

const errors = {
  automation_slot_invalid: 'Проверь время интервала и выбери хотя бы одну фичу. Время указывается в формате ЧЧ:ММ.',
  automation_slots_overlap: 'В одном дне есть пересекающиеся интервалы. Измени их время.',
  automation_slots_required: 'Добавь хотя бы один интервал, чтобы включить автоматизацию.',
  automation_settings_invalid: 'Не удалось сохранить настройки расписания. Проверь дни и интервалы.',
  automation_settings_conflict: 'Расписание уже изменилось. Открой его заново и повтори изменения.',
  automation_account_missing: 'Ученик не найден. Обнови список учеников.',
  automation_writer_active: 'Исполнитель работает в другом backend. Расписание здесь пока нельзя изменить.',
  automation_writer_unavailable: 'Исполнитель временно недоступен. Попробуй сохранить позже.'
}
export const automationFormError = value => errors[value] || value

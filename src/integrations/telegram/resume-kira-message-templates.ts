type KiraTelegramMessage = {
  text: string
  parseMode: 'HTML'
}

type KiraTaskListRow = {
  clientName: string
  market: string
  status: string
  action: string
}

type KiraFinalLinksInput = {
  clientName: string
  ruOnly: boolean
  enVersionUrl?: string
  ruVersionUrl?: string
}

const KIRA_TELEGRAM_PARSE_MODE = 'HTML' as const
const KIRA_TASKS_FOOTER = 'Все задачи: /open_my_tasks'
const KIRA_REJECTION_COMMENT = 'оставь комментарии в резюме'

function escapeTelegramHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function kiraMessage(lines: Array<string | undefined>): KiraTelegramMessage {
  return {
    text: [...lines.filter((line): line is string => line !== undefined), KIRA_TASKS_FOOTER].join('\n'),
    parseMode: KIRA_TELEGRAM_PARSE_MODE
  }
}

function bold(text: string): string {
  return `<b>${text}</b>`
}

function kiraNeedsCommentsMessage(clientName: string): KiraTelegramMessage {
  return kiraMessage([
    bold('📌 Ожидается фидбек по резюме'),
    `Студент: ${escapeTelegramHtml(clientName)}`,
    'Кира, добавь комментарии для подрядчика в следующем сообщении.'
  ])
}

function kiraCommentsSavedMessage(clientName: string): KiraTelegramMessage {
  return kiraMessage([
    bold('✅ Комментарий сохранен'),
    `Фидбек по резюме (${escapeTelegramHtml(clientName)}) записан. Чтобы передать задачу дальше, нажми «Перейти к следующему шагу».`
  ])
}

function kiraDraftReviewMessage(clientName: string): KiraTelegramMessage {
  return kiraMessage([
    bold('🔍 Черновик на проверке'),
    `Студент: ${escapeTelegramHtml(clientName)}`,
    'Кира, проверь черновик и оставь комментарии.'
  ])
}

function kiraEnglishReviewMessage(clientName: string): KiraTelegramMessage {
  return kiraMessage([
    bold('🇬🇧 Проверка EN-версии'),
    `Студент: ${escapeTelegramHtml(clientName)}`,
    'Английская версия готова, ждет твоей проверки.'
  ])
}

function kiraRussianReviewMessage(clientName: string): KiraTelegramMessage {
  return kiraMessage([
    bold('🇷🇺 Проверка RU-версии'),
    `Студент: ${escapeTelegramHtml(clientName)}`,
    'Русская версия готова, ждет твоей проверки.'
  ])
}

function kiraNewTaskMessage(input: {
  stageName: string
  clientName: string
  market: string
  requiredAction: string
  studentDataRows: string[]
  linkAndCommentRows: string[]
}): KiraTelegramMessage {
  const detailRows = [...input.studentDataRows, ...input.linkAndCommentRows]
    .map(escapeTelegramHtml)
  return kiraMessage([
    bold(`⚡️ Новая задача: ${escapeTelegramHtml(input.stageName)}`),
    `Ученик: ${escapeTelegramHtml(input.clientName)} [${escapeTelegramHtml(input.market)}]`,
    escapeTelegramHtml(input.requiredAction),
    ...(detailRows.length ? ['', ...detailRows] : []),
    '',
    '👉 Открой /open_my_tasks, чтобы взять в работу.'
  ])
}

function kiraTaskListMessage(input: {
  from: number
  to: number
  total: number
  tasks: KiraTaskListRow[]
}): KiraTelegramMessage {
  return kiraMessage([
    bold(`📋 Твои задачи по резюме (${input.from}–${input.to} из ${input.total}):`),
    ...input.tasks.map(task => `${escapeTelegramHtml(task.clientName)} [${escapeTelegramHtml(task.market)}] — ${escapeTelegramHtml(task.status)} (${escapeTelegramHtml(task.action)})`)
  ])
}

function kiraNoTasksMessage(): KiraTelegramMessage {
  return kiraMessage([
    bold('🎉 Все чисто!'),
    'Сейчас нет активных задач по резюме.'
  ])
}

function kiraRejectPromptMessage(): KiraTelegramMessage {
  return kiraMessage([
    bold('↩️ Возврат на доработку'),
    `Напиши /resume_reject ${KIRA_REJECTION_COMMENT} или отправь свой комментарий следующим сообщением — передам его подрядчику.`
  ])
}

function kiraReworkMessage(
  version: 'draft' | 'en' | 'ru',
  clientName: string,
  comment: string,
  returnedCvUrl?: string
): KiraTelegramMessage {
  const config = version === 'draft'
    ? { heading: '🛠 Черновик отправлен на доработку', next: 'Ждем новую ссылку на черновик следующим сообщением.' }
    : version === 'en'
      ? { heading: '🛠 EN-версия отправлена на доработку', next: 'Отправь обновленную ссылку на EN-версию следующим сообщением.' }
      : { heading: '🛠 RU-версия отправлена на доработку', next: 'Отправь обновленную ссылку на RU-версию следующим сообщением.' }
  return kiraMessage([
    bold(config.heading),
    `Студент: ${escapeTelegramHtml(clientName)}`,
    `Комментарий: ${escapeTelegramHtml(comment)}`,
    returnedCvUrl ? `Возвращённое резюме: ${escapeTelegramHtml(returnedCvUrl)}` : undefined,
    'Ответственный: подрядчик',
    config.next
  ])
}

function kiraStaleStatusMessage(previousStatus: string, currentStatus: string): KiraTelegramMessage {
  return kiraMessage([
    bold('ℹ️ Статус задачи обновился'),
    `Был: «${escapeTelegramHtml(previousStatus)}» ➔ Стал: «${escapeTelegramHtml(currentStatus)}».`,
    'Обнови список и открой задачу заново.'
  ])
}

function kiraTaskUnavailableMessage(): KiraTelegramMessage {
  return kiraMessage([
    bold('🚫 Задача недоступна'),
    'Эта задача по резюме уже закрыта или перенесена. Обнови список задач.'
  ])
}

function kiraCommentNotRequiredMessage(): KiraTelegramMessage {
  return kiraMessage([
    bold('ℹ️ Комментарий не нужен'),
    'Эта задача больше не ждет фидбека. Обнови список задач.'
  ])
}

function kiraMultipleCommentTasksMessage(): KiraTelegramMessage {
  return kiraMessage([
    bold('⚠️ Выбери конкретную задачу'),
    'У тебя несколько задач ждут комментарий. Открой нужную задачу из списка, чтобы оставить фидбек.'
  ])
}

function finalLinksLines(input: KiraFinalLinksInput): string[] {
  const lines: string[] = []
  if (!input.ruOnly) lines.push(`• EN: ${escapeTelegramHtml(input.enVersionUrl)}`)
  lines.push(`• RU: ${escapeTelegramHtml(input.ruVersionUrl)}`)
  return lines
}

function kiraMovedToFillingMessage(input: KiraFinalLinksInput): KiraTelegramMessage {
  return kiraMessage([
    bold('📤 Резюме ушло на заполнение'),
    `Студент: ${escapeTelegramHtml(input.clientName)}`,
    ...finalLinksLines(input)
  ])
}

function kiraCompletedMessage(input: KiraFinalLinksInput): KiraTelegramMessage {
  return kiraMessage([
    bold('🎉 Резюме готово!'),
    `Студент: ${escapeTelegramHtml(input.clientName)}`,
    ...finalLinksLines(input)
  ])
}

module.exports = {
  KIRA_REJECTION_COMMENT,
  KIRA_TASKS_FOOTER,
  KIRA_TELEGRAM_PARSE_MODE,
  escapeTelegramHtml,
  kiraCommentNotRequiredMessage,
  kiraCommentsSavedMessage,
  kiraCompletedMessage,
  kiraDraftReviewMessage,
  kiraEnglishReviewMessage,
  kiraMovedToFillingMessage,
  kiraMultipleCommentTasksMessage,
  kiraNeedsCommentsMessage,
  kiraNewTaskMessage,
  kiraNoTasksMessage,
  kiraRejectPromptMessage,
  kiraReworkMessage,
  kiraRussianReviewMessage,
  kiraStaleStatusMessage,
  kiraTaskListMessage,
  kiraTaskUnavailableMessage
}

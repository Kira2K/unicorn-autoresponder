type ProviderTelegramMessage = {
  text: string
  parseMode?: 'HTML'
}

type ProviderStage = 'draft' | 'en' | 'ru'

type ProviderTaskCardInput = {
  clientName: string
  market: string
  stack?: string
  realLocation?: string
  desiredLocation?: string
  realAge?: string
  englishLevel?: string
  education?: string
  rootFolder?: string
  sourceFolder?: string
  kirasComments?: string
  draftUrl?: string
  emailEn?: string
  telegramEn?: string
  phoneEn?: string
  linkedInUrl?: string
  githubUrl?: string
}

type ProviderTaskListInput = {
  from: number
  to: number
  total: number
  tasks: Array<{
    clientName: string
    market: string
    status: string
    action: string
  }>
}

const YULIA_TASKS_FOOTER = 'Все задачи: /open_my_tasks'

const STAGE_CONFIG: Record<ProviderStage, {
  status: string
  action: string
  heading: string
  inputHint: string
  savedSubject: string
  reworkHeading: string
  reworkHint: string
}> = {
  draft: {
    status: 'черновик в работе',
    action: 'Подготовь, пожалуйста, черновик CV.',
    heading: 'Черновик резюме',
    inputHint: 'Отправь ссылку на черновик следующим сообщением — я прикреплю её к этой задаче.',
    savedSubject: 'Черновик',
    reworkHeading: 'Черновик отправлен на доработку',
    reworkHint: 'Ждем новую ссылку на черновик следующим сообщением.'
  },
  en: {
    status: 'английская версия в работе',
    action: 'Подготовь, пожалуйста, EN-версию.',
    heading: 'Английская версия',
    inputHint: 'Отправь ссылку на EN-версию следующим сообщением — я прикреплю её к этой задаче.',
    savedSubject: 'Английская версия',
    reworkHeading: 'EN-версия отправлена на доработку',
    reworkHint: 'Отправь обновленную ссылку на EN-версию следующим сообщением.'
  },
  ru: {
    status: 'русская версия в работе',
    action: 'Подготовь, пожалуйста, RU-версию.',
    heading: 'Русская версия',
    inputHint: 'Отправь ссылку на RU-версию следующим сообщением — я прикреплю её к этой задаче.',
    savedSubject: 'Русская версия',
    reworkHeading: 'RU-версия отправлена на доработку',
    reworkHint: 'Отправь обновленную ссылку на RU-версию следующим сообщением.'
  }
}

function escapeTelegramHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function bold(value: string): string {
  return `<b>${escapeTelegramHtml(value)}</b>`
}

function htmlMessage(rows: Array<string | undefined>): ProviderTelegramMessage {
  return {
    text: rows.filter((row): row is string => Boolean(row)).join('\n'),
    parseMode: 'HTML'
  }
}

function plainMessage(rows: Array<string | undefined>): ProviderTelegramMessage {
  return { text: rows.filter((row): row is string => Boolean(row)).join('\n') }
}

function yuliaNewTaskMessage(stage: ProviderStage, clientName: string, market: string): ProviderTelegramMessage {
  const config = STAGE_CONFIG[stage]
  return htmlMessage([
    `Юля, резюме для ${escapeTelegramHtml(clientName)} [${escapeTelegramHtml(market)}] перешло на этап «${config.status}».`,
    config.action,
    'Открой /open_my_tasks, чтобы взять задачу в работу.'
  ])
}

function yuliaTaskCardMessage(stage: ProviderStage, input: ProviderTaskCardInput): ProviderTelegramMessage {
  const config = STAGE_CONFIG[stage]
  const commonRows = [
    bold(config.heading),
    `Студент: ${escapeTelegramHtml(input.clientName)}`,
    `Рынок: ${escapeTelegramHtml(input.market)}`,
    `Статус: ${config.status}`
  ]
  const stageRows = stage === 'draft'
    ? [
        input.stack ? `Стек: ${escapeTelegramHtml(input.stack)}` : undefined,
        input.realLocation ? `Реальная локация: ${escapeTelegramHtml(input.realLocation)}` : undefined,
        input.desiredLocation ? `Желаемая локация: ${escapeTelegramHtml(input.desiredLocation)}` : undefined,
        input.realAge ? `Реальный возраст: ${escapeTelegramHtml(input.realAge)}` : undefined,
        input.englishLevel ? `Уровень английского: ${escapeTelegramHtml(input.englishLevel)}` : undefined,
        input.education ? `Образование: ${escapeTelegramHtml(input.education)}` : undefined,
        input.emailEn ? `Email EN: ${escapeTelegramHtml(input.emailEn)}` : undefined,
        input.telegramEn ? `Telegram EN: ${escapeTelegramHtml(input.telegramEn)}` : undefined,
        input.phoneEn ? `Phone EN: ${escapeTelegramHtml(input.phoneEn)}` : undefined,
        input.linkedInUrl ? `LinkedIn: ${escapeTelegramHtml(input.linkedInUrl)}` : undefined,
        input.githubUrl ? `GitHub: ${escapeTelegramHtml(input.githubUrl)}` : undefined,
        input.rootFolder ? `Корневая папка: ${escapeTelegramHtml(input.rootFolder)}` : undefined,
        input.sourceFolder ? `Исходные данные: ${escapeTelegramHtml(input.sourceFolder)}` : undefined,
        input.kirasComments ? `Комментарии Киры: ${escapeTelegramHtml(input.kirasComments)}` : undefined
      ]
    : [input.draftUrl ? `Черновик: ${escapeTelegramHtml(input.draftUrl)}` : undefined]
  return htmlMessage([
    ...commonRows,
    ...stageRows,
    config.inputHint,
    YULIA_TASKS_FOOTER
  ])
}

function yuliaLinkSavedMessage(stage: ProviderStage, clientName: string): ProviderTelegramMessage {
  const config = STAGE_CONFIG[stage]
  return htmlMessage([
    bold('Ссылка сохранена!'),
    `${config.savedSubject} для ${escapeTelegramHtml(clientName)} записан${stage === 'draft' ? '' : 'а'}. Чтобы передать задачу дальше, нажми «Перейти к следующему шагу».`,
    YULIA_TASKS_FOOTER
  ])
}

function yuliaReworkMessage(stage: ProviderStage, clientName: string, comment: string): ProviderTelegramMessage {
  const config = STAGE_CONFIG[stage]
  return htmlMessage([
    bold(config.reworkHeading),
    `Студент: ${escapeTelegramHtml(clientName)}`,
    `Комментарий: ${escapeTelegramHtml(comment)}`,
    config.reworkHint,
    YULIA_TASKS_FOOTER
  ])
}

function yuliaTaskListMessage(input: ProviderTaskListInput): ProviderTelegramMessage {
  return htmlMessage([
    bold(`Твои задачи по резюме (${input.from}–${input.to} из ${input.total}):`),
    ...input.tasks.map(task => (
      `${escapeTelegramHtml(task.clientName)} [${escapeTelegramHtml(task.market)}] — ${escapeTelegramHtml(task.status)}; ${escapeTelegramHtml(task.action)}`
    )),
    YULIA_TASKS_FOOTER
  ])
}

function yuliaNoTasksMessage(): ProviderTelegramMessage {
  return htmlMessage([
    bold('Все чисто!'),
    'Сейчас нет активных задач по резюме.',
    YULIA_TASKS_FOOTER
  ])
}

function yuliaMultipleLinkTasksMessage(): ProviderTelegramMessage {
  return htmlMessage([
    bold('Выбери конкретную задачу'),
    'Сразу несколько задач ждут ссылку. Открой нужную задачу из списка, чтобы прикрепить ссылку.',
    YULIA_TASKS_FOOTER
  ])
}

function yuliaNoLinkTasksMessage(): ProviderTelegramMessage {
  return plainMessage([
    'Сейчас нет задач, ожидающих ссылку.',
    YULIA_TASKS_FOOTER
  ])
}

function yuliaTaskUnavailableMessage(): ProviderTelegramMessage {
  return htmlMessage([
    bold('Задача недоступна'),
    'Эта задача по резюме уже закрыта или перенесена. Обнови список задач: /open_my_tasks'
  ])
}

function yuliaLinkNotRequiredMessage(): ProviderTelegramMessage {
  return plainMessage([
    'Эта задача больше не ждет ссылку. Обнови список задач: /open_my_tasks'
  ])
}

function yuliaStaleStatusMessage(previousStatus: string, currentStatus: string): ProviderTelegramMessage {
  return htmlMessage([
    bold('Статус задачи обновился'),
    `Был: «${escapeTelegramHtml(previousStatus)}» ➔ Стал: «${escapeTelegramHtml(currentStatus)}».`,
    'Обнови список и открой задачу заново: /open_my_tasks'
  ])
}

function yuliaMissingLinkMessage(): ProviderTelegramMessage {
  return plainMessage([
    'Пожалуйста, отправь ссылку на резюме.',
    YULIA_TASKS_FOOTER
  ])
}

function yuliaInvalidLinkMessage(): ProviderTelegramMessage {
  return plainMessage([
    'Кажется, ссылка некорректная. Пожалуйста, отправь прямую ссылку на документ резюме.',
    YULIA_TASKS_FOOTER
  ])
}

function yuliaWrongActorMessage(): ProviderTelegramMessage {
  return plainMessage([
    'Этот шаг должен выполнить подрядчик.',
    YULIA_TASKS_FOOTER
  ])
}

function yuliaNoClientAccessMessage(clientName: string): ProviderTelegramMessage {
  return plainMessage([
    `У твоего аккаунта нет доступа к студенту ${clientName}.`,
    YULIA_TASKS_FOOTER
  ])
}

module.exports = {
  YULIA_TASKS_FOOTER,
  yuliaInvalidLinkMessage,
  yuliaLinkNotRequiredMessage,
  yuliaLinkSavedMessage,
  yuliaMissingLinkMessage,
  yuliaMultipleLinkTasksMessage,
  yuliaNewTaskMessage,
  yuliaNoClientAccessMessage,
  yuliaNoLinkTasksMessage,
  yuliaNoTasksMessage,
  yuliaReworkMessage,
  yuliaStaleStatusMessage,
  yuliaTaskCardMessage,
  yuliaTaskListMessage,
  yuliaTaskUnavailableMessage,
  yuliaWrongActorMessage
}

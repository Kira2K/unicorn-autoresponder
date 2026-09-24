type PolinaTelegramMessage = {
  text: string
}

type PolinaTaskCardInput = {
  clientName: string
  market: string
  emailRu?: string
  phoneRu?: string
  studentData?: string
  rootFolder?: string
  sourceFolder?: string
  kirasComments?: string
  draftUrl?: string
  enVersionUrl?: string
}

type PolinaTaskListInput = {
  from: number
  to: number
  total: number
  tasks: Array<{
    clientName: string
    market: string
  }>
}

const POLINA_TASKS_FOOTER = 'Все задачи /open_my_tasks'

function message(rows: Array<string | undefined>): PolinaTelegramMessage {
  const body = rows.filter((row): row is string => Boolean(row)).join('\n')
  return { text: [body, '', POLINA_TASKS_FOOTER].join('\n') }
}

function polinaNewTaskMessage(clientName: string, market: string): PolinaTelegramMessage {
  return message([
    `Полина, резюме для ${clientName} (${market}) перешло в статус «русская версия в работе».`,
    'Что нужно сделать: подготовь русскую версию резюме.',
    'Введи /open_my_tasks, чтобы взять задачу в работу.'
  ])
}

function polinaTaskCardMessage(input: PolinaTaskCardInput): PolinaTelegramMessage {
  return message([
    `Ученик: ${input.clientName}`,
    `Рынок: ${input.market}`,
    'Статус: русская версия в работе',
    input.emailRu ? `Email RU: ${input.emailRu}` : undefined,
    input.phoneRu ? `Phone RU: ${input.phoneRu}` : undefined,
    input.studentData || undefined,
    input.rootFolder ? `Основная папка в Google: ${input.rootFolder}` : undefined,
    input.sourceFolder ? `Папка с исходниками: ${input.sourceFolder}` : undefined,
    input.kirasComments ? `Комментарии Киры: ${input.kirasComments}` : undefined,
    input.draftUrl ? `Черновик: ${input.draftUrl}` : undefined,
    input.enVersionUrl ? `EN: ${input.enVersionUrl}` : undefined,
    'Пришли ссылку на русскую версию следующим сообщением.',
    'Я прикреплю её прямо к этой задаче.'
  ])
}

function polinaReworkMessage(input: {
  clientName: string
  market: string
  comment?: string
  enVersionUrl?: string
}): PolinaTelegramMessage {
  return message([
    `Полина, резюме для ${input.clientName} (${input.market}) снова в статусе «русская версия в работе».`,
    'Что нужно сделать: доработай русскую версию резюме.',
    'Открой /open_my_tasks, чтобы посмотреть детали задачи.',
    `Ученик: ${input.clientName}`,
    `Рынок: ${input.market}`,
    'Статус: русская версия в работе',
    input.comment ? `Причина возврата: ${input.comment}` : undefined,
    input.enVersionUrl ? `EN: ${input.enVersionUrl}` : undefined,
    'Пришли новую ссылку на русскую версию следующим сообщением.',
    'Я сразу привяжу её к этой задаче.'
  ])
}

function polinaLinkSavedMessage(clientName: string, market: string, ruVersionUrl: string): PolinaTelegramMessage {
  return message([
    `Ссылка на русскую версию для ${clientName} успешно сохранена.`,
    'Она прикреплена к задаче. Чтобы передать работу дальше, нажми «Перейти к следующему шагу».',
    `Ученик: ${clientName}`,
    `Маркет: ${market}`,
    'Статус: русская версия в работе',
    `RU: ${ruVersionUrl}`
  ])
}

function polinaTaskListMessage(input: PolinaTaskListInput): PolinaTelegramMessage {
  return message([
    `Задачи подрядчика по резюме: показы ${input.from}–${input.to} из ${input.total}`,
    ...input.tasks.map((task, index) => (
      `${index + input.from}. ${task.clientName} [${task.market}] — русская версия в работе (ожидается ссылка на RU)`
    ))
  ])
}

function polinaNoTasksMessage(): PolinaTelegramMessage {
  return message(['У тебя пока нет активных задач по резюме.'])
}

function polinaMultipleLinkTasksMessage(): PolinaTelegramMessage {
  return message(['Сейчас сразу несколько задач ждут ссылку. Пожалуйста, сначала выбери и открой нужную карточку.'])
}

function polinaNoLinkTasksMessage(): PolinaTelegramMessage {
  return message(['Сейчас нет задач, ждущих ссылку.'])
}

function polinaTaskUnavailableMessage(): PolinaTelegramMessage {
  return message(['Эта задача больше недоступна. Обнови список и зайди в неё снова.'])
}

function polinaLinkNotRequiredMessage(): PolinaTelegramMessage {
  return message(['Для этой задачи ссылка больше не нужна. Обнови список задач, чтобы увидеть актуальный статус.'])
}

function polinaStaleStatusMessage(previousStatus: string, currentStatus: string): PolinaTelegramMessage {
  return message([
    `Статус резюме изменился: был «${previousStatus}», стал «${currentStatus}». Пожалуйста, обнови список и открой карточку заново.`
  ])
}

function polinaMissingLinkMessage(): PolinaTelegramMessage {
  return message(['Пожалуйста, прикрепи ссылку на резюме.'])
}

function polinaInvalidLinkMessage(): PolinaTelegramMessage {
  return message(['Пожалуйста, отправь рабочую ссылку на документ резюме.'])
}

function polinaWrongActorMessage(): PolinaTelegramMessage {
  return message(['Этот шаг находится в твоей зоне ответственности.'])
}

function polinaProviderOnlyMessage(): PolinaTelegramMessage {
  return message(['Добавлять ссылки на резюме прямо из чата входит в обязанности исполнителя.'])
}

function polinaUnauthorizedTaskAccountMessage(): PolinaTelegramMessage {
  return message(['Просматривать задачи по резюме могут только авторизованные Telegram-аккаунты Киры или подрядчика.'])
}

function polinaNoClientAccessMessage(clientName: string): PolinaTelegramMessage {
  return message([`Этот аккаунт подрядчика не привязан к ученику ${clientName}.`])
}

function polinaWorkflowNotFoundMessage(): PolinaTelegramMessage {
  return message(['Не удалось найти процесс (workflow) по этому резюме.'])
}

module.exports = {
  POLINA_TASKS_FOOTER,
  polinaInvalidLinkMessage,
  polinaLinkNotRequiredMessage,
  polinaLinkSavedMessage,
  polinaMissingLinkMessage,
  polinaMultipleLinkTasksMessage,
  polinaNewTaskMessage,
  polinaNoClientAccessMessage,
  polinaNoLinkTasksMessage,
  polinaNoTasksMessage,
  polinaProviderOnlyMessage,
  polinaReworkMessage,
  polinaStaleStatusMessage,
  polinaTaskCardMessage,
  polinaTaskListMessage,
  polinaTaskUnavailableMessage,
  polinaUnauthorizedTaskAccountMessage,
  polinaWorkflowNotFoundMessage,
  polinaWrongActorMessage
}

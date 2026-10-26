import type { Checkin, Client, Delivery, State } from './types.mts';
import { EXCLUDED, mention } from './policy.mts';
import { period } from './calendar.mts';
import type { MessageTemplate } from './message-templates.mts';
export const HOME = { text: '🏠 Главное меню', callback_data: 'mentor:home' };
export const homeMarkup = { inline_keyboard: [[HOME]] };
export function addressStudent(text: string, client: Pick<Client, 'username'> & Partial<Pick<Client, 'name'>>): string {
  const tag = mention(client.username);
  if (!tag) return text;
  return client.name ? studentLabel({name: client.name, username: client.username}) + ', ' + text : tag + ' ' + text;
}
export function studentLabel(client: Pick<Client, 'username' | 'name'>): string {
  const tag = mention(client.username);
  return tag ? client.name + ' ' + tag : client.name;
}
export function enqueue(state: State, delivery: Omit<Delivery, 'state' | 'attempts' | 'retryAt'>, now: number): void {
  if (delivery.kind !== 'feedback' && !delivery.clientId) throw new Error('mentor_delivery_client_required');
  if (delivery.kind === 'feedback' && (delivery.clientId || delivery.template)) throw new Error('mentor_feedback_route_invalid');
  if (!state.deliveries[delivery.id]) state.deliveries[delivery.id] =
    { ...delivery, state: 'pending', attempts: 0, retryAt: now };
}
export function report(state: State, client: Client, key: string, text: string | MessageTemplate, reportChatId: string, now: number): void {
  if (!reportChatId.trim()) throw new Error('mentor_report_chat_missing');
  if (EXCLUDED.has(client.status)) return;
  enqueue(state, { id: key + ':report', clientId: client.id, kind: 'report',
    ...(typeof text === 'string' ? {} : {template: structuredClone(text)}),
    input: { chatId: reportChatId, text: typeof text === 'string' ? text : '' } }, now);
}
export function notify(state: State, client: Client, key: string, text: string | MessageTemplate, now: number): void {
  enqueue(state, { id: key + ':notice', clientId: client.id, kind: 'notice',
    template: typeof text === 'string' ? {type: 'notice', text} : structuredClone(text),
    input: { chatId: client.chatId, text: '', replyMarkup: homeMarkup } }, now);
}
export function checkinReport(client: Client, checkin: Checkin, before?: Checkin['result']): string {
  const result = checkin.result!;
  const student = studentLabel(client);
  const yn = (v: boolean) => v ? 'Да' : 'Нет';
  let text = (before ? '🔄 Отчёт об обновлении чекина — ' : '📋 Отчёт по чекину — ') +
    student + '\n' +
    period(checkin.start, checkin.end) + '\nСообщения от рекрутеров: ' + yn(result.recruiters) +
    '.\nПриглашения на собеседования: ' + yn(result.interviews) + '.';
  if (before) {
    const changes: string[] = [];
    if (before.recruiters !== result.recruiters) changes.push('рекрутеры: ' + yn(before.recruiters) + ' → ' + yn(result.recruiters));
    if (before.interviews !== result.interviews) changes.push('собеседования: ' + yn(before.interviews) + ' → ' + yn(result.interviews));
    text += '\nИзменения: ' + changes.join('; ') + '.';
  }
  text += '\n' + (before ? 'Обновил' : 'Подтвердил') + ': @' + result.actor + '.';
  if (!result.recruiters && !result.interviews)
    text += '\n⚠️ У ' + student + ' нет сообщений от рекрутеров и приглашений на собеседования. Проверьте работу по прокачке LinkedIn и автооткликам.';
  return text;
}
export function hardInstruction(client: Client): string {
  return studentLabel(client) + ', поздравляем, с хардами закончили! Теперь пора прокачивать софт-скиллы и готовить самопрезентацию. ' +
    (mention(client.softMentor) ? 'Все вопросы можно задавать твоему софт-ментору ' + mention(client.softMentor) + '.' : 'Софт-ментор пока не назначен. Напиши @veu_support.') +
    '\n\nКак готовиться:\nОткрой новый чат в ChatGPT, Claude или DeepSeek. Прикрепи файл скилла и своё актуальное резюме. Вместе с файлами отправь:\n' +
    '«Прочитай приложенный файл скилла полностью и используй его как инструкцию для проведения занятия, а не для пересказа. Моё резюме также приложено. Начни подготовку: сначала предложи выбрать русский или английский, затем давай по одному заданию и проверяй мои ответы. Сначала предлагай мне попробовать самостоятельно, подсказки давай по запросу. Не составляй всю самопрезентацию за меня. Если какой-либо файл не читается, сообщи об этом. Начинай».\n' +
    'Если ИИ напишет, что не может оценить голос, это ожидаемо: просто продолжай, а финальную запись отправь в чат.\n' +
    'Файл скилла: https://drive.google.com/file/d/1FaJe0kt8l2nwpANlue3-i36qisuIE0KN/view?usp=sharing\n\n' +
    'Когда закончишь подготовку, нажми «🎤 Готовность к самопрезентации» под этим сообщением.';
}

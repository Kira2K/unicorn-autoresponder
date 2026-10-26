import type { SendOneInput } from '../types.ts';
import type { Checkin, Client, Delivery, DeliveryState } from './types.mts';
import { mention, weeks } from './policy.mts';
import { period } from './calendar.mts';
import { addressStudent, checkinReport, hardInstruction, studentLabel } from './messages.mts';
import { marketName, screen } from './screens.mts';
import { stage } from './stage.mts';
import { WELCOME_MESSAGE } from './welcome-message.mts';

/** Only event facts are snapshotted. Names and current mentor/student mentions come from the card. */
export type MessageTemplate =
  | { type: 'screen'; feedback?: MessageTemplate[] }
  | { type: 'welcome' | 'onboarding-notice' | 'hard-instruction' | 'ready-notice' | 'pitch-reminder' | 'monday-report' | 'sync-error' | 'responses-unavailable' }
  | { type: 'notice'; text: string }
  | { type: 'hard-report' | 'ready-revoked'; actor: string }
  | { type: 'ready-report'; actor: string; repeat: boolean }
  | { type: 'mentor-notice'; mentorType: 'hard' | 'soft' }
  | { type: 'mentor-report'; mentorType: 'hard' | 'soft'; before: string; after: string; actor: string }
  | { type: 'market-report'; market: string; actor: string }
  | { type: 'market-notice'; status: string }
  | { type: 'responses-notice'; market: string }
  | { type: 'responses-report'; market: string; actor: string }
  | { type: 'checkin-report'; checkin: Checkin; before?: Checkin['result'] }
  | { type: 'checkin-reminder'; start: number; end: number }
  | { type: 'miss-report'; start: number; end: number; recruiterMisses: number; interviewMisses: number }
  | { type: 'pitch-report'; days: number }
  | { type: 'stage-unmapped' | 'checkin-excluded'; status: string };

function text(t: MessageTemplate, c: Client, state: DeliveryState): string {
  const author = 'actor' in t ? '@' + t.actor : '';
  const student = studentLabel(c);
  switch (t.type) {
    case 'notice': return addressStudent(t.text, c);
    case 'welcome': return WELCOME_MESSAGE;
    case 'onboarding-notice': return '✅ ' + student + ': онбординг завершён. Твой этап — обучение: хард-скиллы.';
    case 'hard-instruction': return hardInstruction(c);
    case 'hard-report': return '✅ ' + student + ': хард-подготовка завершена. ' +
      (mention(c.softMentor) ? 'Передан софт-ментору ' + mention(c.softMentor) + '.' : 'Софт-ментор пока не назначен. Напиши @veu_support.') +
      '\nПодтвердил: ' + author + '.';
    case 'ready-notice': return (mention(c.softMentor) || '@veu_support') + ', ' + student + ' готов к мок-интервью по самопрезентации.';
    case 'ready-report': return '🎤 ' + student + ' готов к мок-интервью по самопрезентации' + (t.repeat ? ' (повторно)' : '') +
      '.\nСофт-ментор: ' + (mention(c.softMentor) || 'не назначен') + '.\nПодтвердил: ' + author + '.';
    case 'ready-revoked': return '↩️ ' + student + ': готовность к мок-интервью снята. Ученик ещё готовится.\nСофт-ментор: ' +
      (mention(c.softMentor) || 'не назначен') + '.\nИзменил: ' + author + '.';
    case 'mentor-notice': {
      const type = t.mentorType === 'hard' ? 'хард' : 'софт';
      const mentor = mention(t.mentorType === 'hard' ? c.hardMentor : c.softMentor);
      return mentor ? student + ', теперь твой ' + type + '-ментор — ' + mentor + '. По всем ' + type +
        ' вопросам обращайся к нему с тегом или ответом на сообщение.' : student + ', ' + type + '-ментор пока не назначен. Напиши @veu_support.';
    }
    case 'mentor-report': return '👤 ' + student + ': ' + (t.mentorType === 'hard' ? 'хард' : 'софт') + '-ментор ' +
      (mention(t.before) || 'Ментор не назначен') + ' → ' + t.after + '.\nПодтвердил: ' + author + '.';
    case 'market-report': return '🚀 ' + student + ', ' + c.stack + ': подготовка к выходу на ' + marketName(t.market) +
      '.\n@veu_support, проверьте готовность профилей, подготовьте hh-резюме и включите отклики.\nПодтвердил: ' + author + '.';
    case 'market-notice': return '✅ ' + student + ': этап изменён — ' + stage({ ...c, status: t.status }, state.learners[c.id]).title + '.';
    case 'responses-notice': return student + ', мы начали откликать тебя на ' + t.market +
      ' рынке! Внимательно следи за приглашениями на собеседования и отвечай рекрутерам как можно быстрее. Если появятся вопросы, пиши нам здесь с тегом @veu_support. Удачи! 🍀';
    case 'responses-report': return '📨 ' + student + ': отклики на ' + t.market + ' рынке запущены.\nПодтвердил: ' + author + '.';
    case 'checkin-report': return checkinReport(c, t.checkin, t.before);
    case 'checkin-reminder': return student + ', привет! Доступен еженедельный чекин.\n' + period(t.start, t.end) +
      '\nСначала ответь про рекрутеров, затем про приглашения на собеседования. Подтверди оба ответа, чтобы сохранить результат.';
    case 'monday-report': return (mention(c.softMentor) || '@veu_support') + ' ' + student + ' не ответил на чекин.';
    case 'miss-report': {
      const lines = [
        t.recruiterMisses ? student + ' не передал информацию о сообщениях рекрутеров ' + t.recruiterMisses + ' ' + weeks(t.recruiterMisses) + ' подряд.' : '',
        t.interviewMisses ? student + ' не передал информацию о приглашениях на собеседования ' + t.interviewMisses + ' ' + weeks(t.interviewMisses) + ' подряд.' : ''
      ].filter(Boolean);
      return '⚠️ Отчёт по незавершённому чекину — ' + student + '\n' + period(t.start, t.end) + '\n' + lines.join('\n');
    }
    case 'pitch-reminder': return student + ', напоминаем о подготовке самопрезентации. Когда будешь готов к мок-интервью, отметь готовность кнопкой ниже.';
    case 'pitch-report': return student + ' не отметил готовность к самопрезентации ' + t.days + ' дней.';
    case 'stage-unmapped': return student + ': /what_my_stage, статус ' + (t.status || 'не указан') + ' без описания.';
    case 'sync-error': return 'Данные этапа ' + student + ' требуют проверки. Обратись к @veu_support. Изменения не сохранены.';
    case 'responses-unavailable': return 'Для ' + student + ' нельзя подтвердить запуск откликов на текущем этапе: ' +
      stage(c, state.learners[c.id]).title + '. Обратись к @veu_support.';
    case 'checkin-excluded': return student + ', чекины недоступны при текущем статусе: ' + t.status + '.';
    case 'screen': throw new Error('mentor_screen_context_required');
  }
}

/** Called inside the claim transaction, again for each retry, without external side effects. */
export function renderDelivery(state: DeliveryState, delivery: Delivery): SendOneInput {
  if (!delivery.template) return delivery.input; // Existing literal jobs remain readable.
  const c = state.clients[delivery.clientId!];
  if (delivery.template.type === 'screen') {
    const s = state.sessions[delivery.sessionId!];
    const input = screen(state, s, c, state.learners[c.id]);
    const feedback = delivery.template.feedback?.map(t => text(t, c, state));
    if (feedback?.length) {
      const escape = (value:string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      input.text = feedback.map(value => input.parseMode === 'HTML' ? escape(value) : value).join('\n\n') + '\n\n' + input.text;
    }
    return input;
  }
  return { ...delivery.input, text: text(delivery.template, c, state) };
}

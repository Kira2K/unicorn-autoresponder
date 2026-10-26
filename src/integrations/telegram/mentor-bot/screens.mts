import type { SendOneInput } from '../types.ts';
import type { Client, Learner, Session, State } from './types.mts';
import { HOME, studentLabel } from './messages.mts';
import { period } from './calendar.mts';
import { stage } from './stage.mts';
import { startHardPreparation } from './hard-preparation.mts';
import { allowed, MARKET_OPTIONS, mergeMarket, mention, responsesStatus } from './policy.mts';
export function screen(state: Pick<State, 'checkins'>, s: Session, c: Client, l: Learner): SendOneInput {
  const button = (text: string, action: string) => ({ text, callback_data: 'm:' + s.id + ':' + s.revision + ':' + action });
  const home = [HOME], back = button('Назад', 'back'), confirm = button('✅ Подтвердить выбор', 'confirm');
  const cancel = button('Отмена', 'cancel');
  const name = s.role === 'student' ? studentLabel(c) : c.name;
  let text = 'Управление обучением — ' + name + '\nВыбери действие.';
  let parseMode: SendOneInput['parseMode'];
  // Public entry points open the clicker's own session; answers remain session-owned.
  const studentRows = [[{ text: '📍 Мой этап', callback_data: 'mentor:stage' }]];
  if (allowed('student','ready',c)) studentRows.push(
    [{ text: '🎤 Готовность к самопрезентации', callback_data: 'mentor:ready' }],
    [{ text: '📋 Еженедельный чекин', callback_data: 'mentor:checkin' }]);
  let rows = [...studentRows];
  if (allowed(s.role,'onboarding',c)) rows.push([button('✅ Завершить онбординг', 'onboarding')]);
  if (allowed(s.role,'hard',c)) rows.push([button('✅ Завершить харды', 'hard')], [button('🚀 Выход на рынок', 'market')],
    [button('📨 Подтвердить запуск откликов', 'responses')], [button('👤 Выбор ментора', 'mentor')]);
  if (s.action === 'menu') rows.push(home);
  if (s.action === 'stage') {
    const current = stage(c, l);
    text = current.text; parseMode = current.parseMode; rows = [home];
  }
  else if (s.action === 'onboarding') {
    const nextLearner = {...l};
    startHardPreparation(nextLearner);
    text = 'Завершение онбординга — ' + name + '\nПодтверди, что онбординг завершён.\nТекущий этап: ' + stage(c,l).title +
      '.\nНовый этап: ' + stage({...c,status:'studying'},nextLearner).title + '.';
    rows = [[confirm], [cancel], home];
  } else if (s.action === 'hard') {
    text = 'Завершение хард-подготовки — ' + name + '\nПодтверди, что хард-подготовка завершена.\nПосле подтверждения ученик получит инструкцию по подготовке самопрезентации, а в «Ботоотчеты» поступит отчёт о передаче софт-ментору.';
    rows = [[confirm], [cancel], home];
  } else if (s.action === 'ready') {
    text = 'Готовность к самопрезентации — ' + name + '\nПодготовка с ИИ пройдена и/или финальная запись самопрезентации отправлена в чат?';
    rows = [[button('Да, готов', 'yes'), button('Ещё не готов', 'no')], [back], home];
    if (s.step === 'result') {
      text = '✅ ' + name + ': готовность сохранена — ' + (l.ready ? 'готов к мок-интервью' : 'ещё готовится') + '.';
      rows = [[button('✏️ Изменить ответ', 'edit')], home];
    } else if (s.step === 'confirm') {
      text = 'Ученик: ' + name + '.\nВыбрано: ' + (s.value === 'yes' ? 'Готов к мок-интервью' : 'Ещё готовится') + '.\nПодтверди выбранный ответ.';
      rows = [[button('✏️ Изменить ответ', 'edit')], [confirm], home];
    }
  } else if (s.action === 'market') {
    text = '🚀 Выход на рынок — ' + name + '\nВыбери рынок для этого ученика.';
    rows = [[button('РУ', 'ru'), button('ВУ', 'en'), button('РУ + ВУ', 'both')], [back], home];
    if (s.step === 'confirm') {
      text = 'Подтверди выход на рынок для ' + name + '.\nТекущий этап: ' + stage(c,l).title +
        '.\nРынок: ' + (c.market ? MARKET_OPTIONS[c.market].label : 'не указан') + ' → ' +
        MARKET_OPTIONS[mergeMarket(c.market,s.value as keyof typeof MARKET_OPTIONS)].label +
        '.\nНовый этап: Подготовка к откликам на ' + marketName(s.value!) +
        '.\nПосле подтверждения команда получит задачу подготовить профили и запустить отклики.';
      rows = [[button('✏️ Изменить выбор', 'edit')], [confirm], [cancel], home];
    }
  } else if (s.action === 'responses') {
    const market = responsesStatus(c.status) === 'on en market' ? 'en' : 'ru';
    text = 'Запуск откликов — ' + name + '\nПодтверди, что отклики на ' + marketName(market) +
      ' уже запущены.\nТекущий этап: ' + stage(c,l).title + '.\nНовый этап: Отклики на ' + marketName(market) + '.';
    rows = [[confirm], [cancel], home];
  } else if (s.action === 'mentor') {
    const type = s.mentorType === 'hard' ? 'хард' : 'софт';
    const old = mention(s.mentorType === 'hard' ? c.hardMentor : c.softMentor) || 'Ментор не назначен';
    text = 'Выбор ментора — ' + name + '\nКакого ментора нужно указать?';
    rows = [[button('Хард-ментора', 'hard-type'), button('Софт-ментора', 'soft-type')], [back], home];
    if (s.step === 'mentor-input') {
      text = 'Текущий ' + type + '-ментор: ' + old + '.\nВведи @username нового ' + type + '-ментора для ' + name + '.';
      rows = [[back], home];
    } else if (s.step === 'confirm') {
      text = 'Подтверди выбор ментора — ' + name + '.\nТип: ' + type + '-ментор.\nТекущий: ' + old + '.\nНовый: @' + s.value +
        '.\nПосле подтверждения данные обновятся, а ученик получит уведомление.';
      rows = [[button('✏️ Изменить выбор', 'edit')], [confirm], [cancel], home];
    }
  } else if (s.action === 'checkin') {
    const ch = state.checkins[s.checkinId!];
    const header = name + '\n' + period(ch.start, ch.end);
    const yn = (v?: boolean) => v ? 'Да' : 'Нет';
    if (s.step === 'result') {
      text = '✅ ' + name + ', результат чекина сохранён.\n' + period(ch.start, ch.end) + '\nСообщения от рекрутеров: ' + yn(ch.result?.recruiters) +
        '.\nПриглашения на собеседования: ' + yn(ch.result?.interviews) + '.\nСледующий чекин будет доступен в четверг в 17:00 МСК.';
      rows = [[button('✏️ Изменить ответ', 'edit')], home];
    } else if (s.step === 'q1' || s.step === 'q2') {
      text = 'Чекин — ' + header + '\n\n' + (s.step === 'q1' ? '1 из 2. Писали рекрутеры за этот период?' : '2 из 2. Были приглашения на собеседования за этот период?');
      if (ch.result) text += '\nТекущий ответ: ' + yn(s.step === 'q1' ? ch.result.recruiters : ch.result.interviews) + '.';
      rows = [[button('Да', 'yes'), button('Нет', 'no')], [back], home];
    } else {
      text = (s.step === 'q1-confirm' ? 'Проверь ответ — ' : 'Проверь ответы — ') + header + '\n\n' + (s.step === 'q1-confirm'
        ? 'Писали рекрутеры?\nВыбранный ответ: ' + yn(s.recruiters) + '.\nРезультат будет сохранён после подтверждения второго вопроса.'
        : 'Сообщения от рекрутеров: ' + yn(s.recruiters) + ' — первый ответ подтверждён.\nПриглашения на собеседования: ' + yn(s.interviews) + '.\nПодтверди второй ответ, чтобы сохранить результат чекина.');
      rows = [[button('✏️ Изменить ответы', 'edit')], [confirm], home];
    }
  }
  if (s.role === 'staff' && s.action !== 'menu') rows.splice(rows.length - 1, 0, ...studentRows);
  return { chatId: s.chatId, text, ...(parseMode ? { parseMode } : {}),
    ...(s.messageId ? { editMessageId: s.messageId } : {}), replyMarkup: { inline_keyboard: rows } };
}
export function marketName(value: string): string { return value === 'en' ? 'ВУ рынке' : value === 'both' ? 'РУ и ВУ рынках' : 'РУ рынке'; }

import type { Client, Learner } from './types.mts';
import { mention } from './policy.mts';
import { studentLabel } from './messages.mts';
export function stage(client: Client, learner: Learner): { text: string; known: boolean; title: string; parseMode?: 'HTML' } {
  const data: Record<string, [string, string, string, string]> = {
    onboarding: ['Онбординг', 'Изучи материалы из закрепа и заполни личный кабинет: личные данные, доступы, стоп-лист', 'Обучение: хард-скиллы', 'Заполнить личный кабинет, команда переведёт тебя дальше'],
    studying: learner.hardCompletedAt === undefined
      ? ['Обучение: хард-скиллы', 'Занимайся с хард-ментором по программе', 'Обучение: софт-скиллы', 'Хард-ментор отметит, что харды готовы']
      : ['Обучение: софт-скиллы', 'Готовь самопрезентацию по инструкции и нажми «🎤 Готовность к самопрезентации» (или /ready_pitch)', 'Выход на рынок', 'Пройти мок-интервью с софт-ментором'],
    'hh_ru process': ['Подготовка к откликам на РУ рынке', 'Создай профиль hh.ru по инструкции и внеси доступы в личный кабинет', 'Отклики на РУ рынке', 'Команда проверит профили и запустит отклики'],
    'hh_both process': ['Подготовка к откликам на РУ и ВУ рынках', 'Создай профиль hh.ru по инструкции и внеси доступы в личный кабинет', 'Отклики на ВУ рынке', 'Команда проверит профили и запустит отклики'],
    'hh_en process': ['Подготовка к откликам на ВУ рынке', 'Создай второй профиль hh.ru с иностранными номером и почтой и внеси доступы в личный кабинет', 'Отклики на ВУ рынке', 'Команда проверит профили и запустит отклики'],
    'on ru market': ['Отклики на РУ рынке', 'Следи за приглашениями, отвечай рекрутерам, ходи на собеседования',
      client.market === 'en' || client.market === 'both' ? 'Выход на ВУ рынок' : '',
      client.market === 'en' || client.market === 'both' ? 'Ментор решит, когда пора на ВУ' : ''],
    'on en market': ['Отклики на ВУ рынке', 'Следи за приглашениями, отвечай рекрутерам, ходи на собеседования', '', ''],
    paused: ['Пауза', '—', 'Возврат к прошлому этапу', 'Напиши @veu_support, когда будешь готов продолжить'],
  };
  const row = data[client.status];
  if (!row) return { known: false, title: client.status || 'не указан',
    text: studentLabel(client) + ', напиши @veu_support, мы подскажем твой этап.' };
  const mentor = client.status === 'onboarding' ? '@veu_support' :
    mention(client.status === 'studying' && learner.hardCompletedAt === undefined ? client.hardMentor : client.softMentor);
  const current = '📍 ' + studentLabel(client) + ', текущий этап: ' + row[0] + '.\nСейчас: ' + row[1] + '.';
  const next = (row[2] ? '\n\nСледующий этап: ' + row[2] + '.' + (row[3] ? '\nДля перехода: ' + row[3] + '.' : '') : '') +
    (mentor ? '\n\nВопросы по этапу — ' + mentor + '.' : '') + '\nОрганизационные вопросы — @veu_support.';
  if (['hh_ru process', 'hh_en process', 'hh_both process'].includes(client.status)) {
    const html = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return { known: true, title: row[0], parseMode: 'HTML',
      text: html(current) +
        '\n<a href="https://melodic-firewall-a6d.notion.site/hh-ru">Вот ссылка на инструкцию по созданию hh</a> ' +
        '(это безопасная ссылка, несмотря на предупреждение от Notion)' + html(next) };
  }
  return { known: true, title: row[0], text: current + next };
}

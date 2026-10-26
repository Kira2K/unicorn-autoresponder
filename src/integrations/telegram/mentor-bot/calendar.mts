export const DAY = 86_400_000;
export const WEEK = 7 * DAY;
// Europe/Moscow is UTC+03:00. Derive the wall clock with Intl, not the host timezone.
function parts(at: number) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const value = (key: string) => Number(p.find(x => x.type === key)!.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}
export function nextThursday(at: number): number {
  const p = parts(at);
  const date = Date.UTC(p.year, p.month - 1, p.day, 14);
  const thursday = date + ((4 - new Date(date).getUTCDay() + 7) % 7) * DAY;
  return thursday < at ? thursday + WEEK : thursday;
}
export function mondayAfter(openedAt: number): number { return openedAt + 4 * DAY - 5 * 3_600_000; }
export function dateLabel(at: number): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
export function period(start: number, end: number): string { return 'Период: ' + dateLabel(start) + ' — ' + dateLabel(end); }

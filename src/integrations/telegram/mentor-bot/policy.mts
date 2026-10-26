import {ACTIONS} from './types.mts';
import type { Action, Client, Delivery, Role, Session, State } from './types.mts';
export const EXCLUDED = new Set(['graduated', 'blacklisted', 'paused', 'left', 'unknown']);
export const CHECKIN_STATUSES = new Set([
  'hh_ru process', 'hh_en process', 'hh_both process', 'on ru market', 'on en market'
]);
export function checkinDelivery(delivery: Delivery, sessions: Record<string,Session>): boolean {
  return !!delivery.checkinId ||
    ['checkin-report','checkin-reminder','miss-report','monday-report'].includes(delivery.template?.type??'') ||
    /^(miss:|monday:|reminder:)/.test(delivery.id) ||
    (!!delivery.sessionId && sessions[delivery.sessionId]?.action === 'checkin');
}
export const MARKET_OPTIONS = {
  ru: {id:1,status:'hh_ru process',label:'РУ'},
  en: {id:2,status:'hh_en process',label:'ВУ'},
  both: {id:3,status:'hh_both process',label:'РУ + ВУ'}
} as const;
export function mergeMarket(current: Client['market'], requested: keyof typeof MARKET_OPTIONS): keyof typeof MARKET_OPTIONS {
  return current === null || current === requested ? requested : 'both';
}
export function responsesStatus(status:string):'on ru market'|'on en market'|undefined{
  return status==='hh_ru process'?'on ru market':
    status==='hh_en process'||status==='hh_both process'?'on en market':undefined;
}
export function username(value: string): string {
  const normalized = value.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z][a-z0-9_]{4,31}$/.test(normalized) ? normalized : '';
}
export function mention(value: string): string {
  const tag = username(value);
  return tag ? '@' + tag : '';
}
export function clientVersion(c: Client): string {
  return JSON.stringify([c.name, c.username, c.chatId, c.status, c.market, c.hardMentor, c.softMentor]);
}
export function authorize(state: State, chatId: string, actor: string): { client: Client; role: Role } | null {
  const tag = username(actor);
  if (!tag) return null;
  const clients = Object.values(state.clients);
  const chat = clients.filter(c => c.chatId === chatId);
  const matches = clients.filter(c => username(c.username) === tag);
  if (chat.length !== 1 || matches.length > 1 || (matches.length === 1 && matches[0].id !== chat[0].id)) return null;
  if (!state.learners[chat[0].id]) return null;
  return { client: chat[0], role: matches.length ? 'student' : 'staff' };
}
export function allowed(role: Role, action: string, client?: Pick<Client,'username'|'status'>): boolean {
  if (!ACTIONS.includes(action as Action)) return false;
  if (client && !username(client.username) && !['menu','stage'].includes(action)) return false;
  if (action === 'onboarding') return role === 'staff' && client?.status === 'onboarding';
  return role === 'staff' || ['menu', 'stage', 'ready', 'checkin'].includes(action);
}
export function weeks(count: number): string {
  const n = Math.abs(count), last = n % 10, two = n % 100;
  return two >= 11 && two <= 14 ? 'недель' : last === 1 ? 'неделю' : last >= 2 && last <= 4 ? 'недели' : 'недель';
}

import type { CreationTask } from '../creation-tasks/contracts.mts';
export const blockedFields = ['fullName', 'country', 'company', 'position', 'blockedAt', 'newFullName', 'legacyText'] as const;
export type BlockedAccount = Partial<Record<typeof blockedFields[number], string>>;
export interface LinkedInIntake {
  scenario: 'existing' | 'new';
  url: string; login: string; password: string;
  outlookLogin: string; outlookPassword: string;
  outlookRegisteredAt?: string;
  replacesLinkedInAccountId?: number;
  firstName: string; lastName: string; realLocation: string;
  blockedAccounts: BlockedAccount[]; loggedIn: boolean;
  hasBlockedAccounts?:boolean;
}
export interface LinkedInIntakeView {
  url:string;login:string;hasPassword:boolean;outlookLogin:string;hasOutlookPassword:boolean;
  firstName:string;lastName:string;realLocation:string;blockedAccounts:BlockedAccount[];
  outlookRegisteredAt?:string;task?:CreationTask;editLocked?:boolean;completionConfirmed?:boolean;registrationPending?:boolean;
  linkedinAccountId?:number;outlookAccountId?:number;hasLinkedIn?:boolean;
  hadLinkedInBeforeTask?:boolean;previousOctoProfileIds?:number[];
  archivedBlockedAccounts?:BlockedAccount[];editableBlockedAccounts?:BlockedAccount[];isBanned?:boolean;warmupUntil?:string;
}
export const clientFieldLabels={firstName:'Имя',lastName:'Фамилия',primaryStack:'Основной стек',commonChatId:'Общий Telegram-чат',market:'Рынок поиска работы',calendarEmail:'Личный email'} as const;
export function safeClientFields(value:unknown){return Array.isArray(value)?[...new Set(value.filter((field):field is keyof typeof clientFieldLabels=>typeof field==='string'&&Object.hasOwn(clientFieldLabels,field)))].map(field=>({field,label:clientFieldLabels[field]})):[];}
export class IntakeError extends Error {
  code: string; status: number;
  fields?:Array<{field:string;label:string}>;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const completeBlockedAccount = (card:BlockedAccount) => (['fullName','country','company','position','blockedAt'] as const).every(field=>!!text(card[field]));
export const sameBlockedAccount = (left:BlockedAccount,right:BlockedAccount) => blockedFields.every(field=>text(left[field])===text(right[field]));
export const isOutlookLogin = (value: unknown) => /^[^@\s]+@outlook\.com$/i.test(text(value));
export const isLatinIntakeName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z '\-]*$/.test(value);
function registrationTime(value: unknown,now:number): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new IntakeError('linkedin_intake_outlook_registration_invalid');
  if(Date.parse(value)>now)throw new IntakeError('linkedin_intake_outlook_registration_future');
  return value;
}
export function parseLinkedInResult(raw: Record<string, unknown>) {
  const url = text(raw.url), login = text(raw.login), password = typeof raw.password === 'string' ? raw.password : '';
  if (!/^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[^/?#\s]+([/?#][^\s]*)?$/i.test(url) || !login ||
      [url, login, password].some(v => v.length > 4096)) throw new IntakeError('linkedin_intake_account_required');
  return { url, login, password };
}
export function normalizeBlockedAccounts(value: unknown): BlockedAccount[] {
  if (!Array.isArray(value) || value.length > 100) throw new IntakeError('linkedin_intake_blocked_invalid');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new IntakeError('linkedin_intake_blocked_invalid');
    return Object.fromEntries(blockedFields.map(key => [key, text(item[key])]).filter(([, v]) => v));
  }).filter(item => Object.keys(item).length);
}
/** Old free text remains editable, including text we cannot safely interpret. */
export function readBlockedAccounts(value: unknown): BlockedAccount[] {
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.some(item => item && typeof item === 'object' &&
      Object.keys(item).some(key => !blockedFields.includes(key as typeof blockedFields[number])))) return [{ legacyText: raw }];
    return normalizeBlockedAccounts(parsed);
  } catch { /* Legacy text is not JSON. */ }
  const lines = raw.split(/\r?\n/), result: BlockedAccount = {};
  const labels = { 'Страна': 'country', 'Компания': 'company', 'Должность': 'position',
    'Дата блока': 'blockedAt', 'ФИ для нового аккаунта': 'newFullName' } as const;
  const unknown: string[] = [];
  for (const [index, line] of lines.entries()) {
    const pair = Object.entries(labels).find(([label]) => line.startsWith(label + ':'));
    if (pair) result[pair[1]] = line.slice(pair[0].length + 1).trim();
    else if (index === 0 && !line.includes(':')) result.fullName = line;
    else if (line) unknown.push(line);
  }
  if (unknown.length) result.legacyText = unknown.join('\n');
  return Object.keys(result).length ? [result] : [{ legacyText: raw }];
}
export function parseIntake(value: unknown,now=Date.now()): LinkedInIntake {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeError('linkedin_intake_invalid');
  const raw = value as Record<string, unknown>;
  if (!['existing', 'new'].includes(String(raw.scenario))) throw new IntakeError('linkedin_intake_scenario_required');
  if (raw.replacesLinkedInAccountId !== undefined && (raw.scenario !== 'new' || typeof raw.replacesLinkedInAccountId !== 'number' ||
      !Number.isSafeInteger(raw.replacesLinkedInAccountId) || raw.replacesLinkedInAccountId < 1))
    throw new IntakeError('linkedin_intake_replacement_invalid');
  const fields = ['url', 'login', 'outlookLogin', 'firstName', 'lastName', 'realLocation'] as const;
  const data = Object.fromEntries(fields.map(key => [key, text(raw[key])])) as Pick<LinkedInIntake, typeof fields[number]>;
  if (Object.values(data).some(v => v.length > 4096)) throw new IntakeError('linkedin_intake_invalid');
  const password = typeof raw.password === 'string' ? raw.password : '';
  const outlookPassword = typeof raw.outlookPassword === 'string' ? raw.outlookPassword : '';
  if (password.length > 4096 || outlookPassword.length > 4096) throw new IntakeError('linkedin_intake_invalid');
  if (raw.scenario === 'existing') {
    parseLinkedInResult(raw);
    if (raw.loggedIn !== true) throw new IntakeError('linkedin_intake_login_confirmation_required');
  } else {
    if (!isOutlookLogin(data.outlookLogin)) throw new IntakeError('linkedin_intake_outlook_required');
    if (![data.firstName, data.lastName].every(isLatinIntakeName) || !data.realLocation)
      throw new IntakeError('linkedin_intake_identity_required');
  }
  const outlookRegisteredAt = raw.scenario === 'new' ? registrationTime(raw.outlookRegisteredAt,now) : undefined;
  const blockedAccounts=normalizeBlockedAccounts(raw.blockedAccounts??[]);
  if(raw.hasBlockedAccounts!==undefined&&typeof raw.hasBlockedAccounts!=='boolean')throw new IntakeError('linkedin_intake_blocked_invalid');
  if(raw.hasBlockedAccounts===true&&(!blockedAccounts.length||blockedAccounts.some(card=>!completeBlockedAccount(card))))throw new IntakeError('linkedin_intake_blocked_required');
  if(raw.hasBlockedAccounts===false&&blockedAccounts.length)throw new IntakeError('linkedin_intake_blocked_invalid');
  return { ...data, scenario: raw.scenario as LinkedInIntake['scenario'], password, outlookPassword,
    ...(raw.replacesLinkedInAccountId !== undefined ? {replacesLinkedInAccountId:raw.replacesLinkedInAccountId as number} : {}),
    ...(outlookRegisteredAt ? { outlookRegisteredAt } : {}),
    ...(raw.hasBlockedAccounts!==undefined?{hasBlockedAccounts:raw.hasBlockedAccounts as boolean}:{}),loggedIn: raw.loggedIn === true, blockedAccounts };
}
/** Future staff-task boundary: preparation data only, never an automated signup. */
export interface LinkedInRegistrationHandoff {
  clientId: number; linkedinAccountId: number; outlookAccountId: number; octoProfileIds: number[];
}

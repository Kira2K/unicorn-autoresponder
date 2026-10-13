import { validateStudentEducation } from './student-education.ts';
import type { EducationRow } from './student-education.ts';
export type { EducationRow } from './student-education.ts';
export type WorkPlace = { id?: string; companyName: string; isCurrent: boolean };
export type StudentProfile = {
  firstName: string; lastName: string; middleName: string; fio: string; birthDate: string;
  realAge: number | null; englishLevelId: number | null; readyForInterviewInEnglishIn2Months: string;
  educationEntries: EducationRow[]; noHigherEducation: boolean;
  realLocation: string; desiredLocation: string; workPlaces: WorkPlace[];
  calendarEmail: string; telegramPersonalChatId: string;
};
export const profileFieldLabels: Record<string, string> = {
  firstName: 'Имя', lastName: 'Фамилия', middleName: 'Отчество', birthDate: 'Дата рождения',
  englishLevelId: 'Уровень английского', readyForInterviewInEnglishIn2Months: 'Готовность к интервью',
  educationEntries: 'Образование', realLocation: 'Реальная локация', desiredLocation: 'Желаемая локация',
  workPlaces: 'Места работы', calendarEmail: 'Личный email (Gmail)', telegramPersonalChatId: 'Личный Telegram'
};
export const cleanProfileText = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ');
export function profileToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function isoBirthDate(value: unknown): string {
  const text = cleanProfileText(value);
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
}
export function formatBirthDate(value: unknown): string {
  const iso = isoBirthDate(value);
  return iso ? iso.split('-').reverse().join('.') : '';
}
export function profileAge(value: unknown, today = profileToday()): number | null {
  const date = isoBirthDate(value);
  if (!date || date > today) return null;
  const age = Number(today.slice(0, 4)) - Number(date.slice(0, 4)) - Number(today.slice(5) < date.slice(5));
  return age > 0 ? age : null;
}
export const profileFullName = (value: { firstName?: unknown; lastName?: unknown; middleName?: unknown }) =>
  [value.lastName, value.firstName, value.middleName].map(cleanProfileText).filter(Boolean).join(' ');
export function normalizeRussianPhone(value: unknown): string {
  const phone = String(value ?? '').replace(/[\s()\-]/g, '');
  return /^8\d{10}$/.test(phone) ? '+7' + phone.slice(1) : phone;
}
export const russianPhoneError = 'Номер в формате +7 и 10 цифр, например +79991234567';
export const isRussianPhone = (value: unknown) => /^\+7\d{10}$/.test(normalizeRussianPhone(value));
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const locationPattern = /^[A-Za-z][A-Za-z .'\-]*,\s*[A-Za-z][A-Za-z .'\-]*$/;
const normalizeLocation = (value: unknown) => cleanProfileText(value).replace(/\s*,\s*/g, ', ');
const namePattern = /^[\p{Script=Cyrillic}][\p{Script=Cyrillic} -]*[\p{Script=Cyrillic}]$/u;
export function validateWorkPlaces(input: unknown): { value: WorkPlace[]; error: string } {
  const value = (Array.isArray(input) ? input : []).map(item => {
    const row = object(item);
    return { ...(row.id != null ? { id: String(row.id) } : {}), companyName: cleanProfileText(row.companyName), isCurrent: row.isCurrent === true };
  }).filter(row => row.companyName);
  const names = value.map(row => row.companyName.toLowerCase());
  const invalid = value.length > 20 || value.some(row => row.companyName.length > 100 || row.companyName.includes(',')) || new Set(names).size !== names.length;
  return { value, error: invalid ? 'Название компании: до 100 символов, без запятых, без повторов' : '' };
}
export function validateStudentProfile(input: unknown, options: { today?: string; englishLevelIds: readonly number[] }) {
  const draft = object(input), today = options.today ?? profileToday();
  const noHigherEducation = draft.noHigherEducation === true;
  const education = validateStudentEducation(draft.educationEntries, noHigherEducation, Number(today.slice(0, 4)));
  const workplaceValidation = validateWorkPlaces(draft.workPlaces);
  const workPlaces = workplaceValidation.value;
  const telegram = cleanProfileText(draft.telegramPersonalChatId);
  const value: StudentProfile = {
    firstName: cleanProfileText(draft.firstName), lastName: cleanProfileText(draft.lastName), middleName: cleanProfileText(draft.middleName),
    fio: profileFullName(draft), birthDate: isoBirthDate(draft.birthDate), realAge: profileAge(draft.birthDate, today),
    englishLevelId: Number(draft.englishLevelId) || null,
    readyForInterviewInEnglishIn2Months: cleanProfileText(draft.readyForInterviewInEnglishIn2Months),
    educationEntries: education.value, noHigherEducation,
    realLocation: normalizeLocation(draft.realLocation),
    desiredLocation: /^remote$/i.test(cleanProfileText(draft.desiredLocation)) ? 'Remote' : normalizeLocation(draft.desiredLocation),
    workPlaces, calendarEmail: cleanProfileText(draft.calendarEmail).toLowerCase(),
    telegramPersonalChatId: telegram ? '@' + telegram.replace(/^@/, '') : ''
  };
  const errors: Record<string, string> = {}, educationErrors = education.errors;
  for (const name of ['firstName', 'lastName', 'middleName'] as const) {
    const text = value[name];
    if (name === 'middleName' && !text) continue;
    if (text.length < 2 || text.length > 50 || !namePattern.test(text))
      errors[name] = `Укажите ${name === 'firstName' ? 'имя' : name === 'lastName' ? 'фамилию' : 'отчество'} (2–50 символов, только буквы (кириллица), пробел и дефис)`;
  }
  if (!value.birthDate) errors.birthDate = 'Укажите дату рождения';
  else if (value.birthDate > today) errors.birthDate = 'Дата рождения не может быть в будущем';
  else if (value.realAge === null || value.realAge < 14 || value.realAge > 70) errors.birthDate = 'Проверьте дату: возраст должен быть от 14 до 70 лет';
  if (!options.englishLevelIds.includes(value.englishLevelId ?? 0)) errors.englishLevelId = 'Выберите уровень английского';
  if (!['Yes', 'No'].includes(value.readyForInterviewInEnglishIn2Months)) errors.readyForInterviewInEnglishIn2Months = 'Выберите вариант';
  if (education.error) errors.educationEntries = education.error;
  if (!locationPattern.test(value.realLocation)) errors.realLocation = 'Укажите в формате City, Country латиницей';
  if (value.desiredLocation !== 'Remote' && !locationPattern.test(value.desiredLocation)) errors.desiredLocation = 'Укажите City, Country латиницей или Remote';
  if (workplaceValidation.error) errors.workPlaces = workplaceValidation.error;
  if (!/^[A-Za-z0-9._%+\-]+@gmail\.com$/i.test(value.calendarEmail)) errors.calendarEmail = 'Укажите адрес на @gmail.com';
  if (!/^@?[A-Za-z0-9_]{5,32}$/.test(telegram)) errors.telegramPersonalChatId = 'Укажите username: 5–32 символа, латиница, цифры и «_»';
  return { value, errors, educationErrors, valid: Object.keys(errors).length === 0 };
}

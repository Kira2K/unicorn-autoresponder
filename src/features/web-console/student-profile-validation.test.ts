import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateStudentProfile, profileAge, profileFullName, isRussianPhone, normalizeRussianPhone } from './student-profile-validation.ts';
const options = { today: '2026-10-05', englishLevelIds: [1] };
const complete = () => ({ firstName: 'Кира', lastName: 'Самсонова', middleName: '', birthDate: '20.04.2000', englishLevelId: '1',
  readyForInterviewInEnglishIn2Months: 'No', educationEntries: [{ uni: 'Университет', faculty: 'Факультет', grade: 'Бакалавр', yearOfEnd: '2022' }],
  realLocation: 'Tbilisi,Georgia', desiredLocation: 'remote', calendarEmail: 'Kira@gmail.com', telegramPersonalChatId: 'kira_s', workPlaces: [] });
test('names, calendar age and normalized values follow the specification', () => {
  assert.equal(profileFullName(complete()), 'Самсонова Кира');
  assert.equal(profileFullName({ ...complete(), middleName: 'Андреевна' }), 'Самсонова Кира Андреевна');
  assert.equal(profileAge('20.04.2000', options.today), 26);
  assert.equal(profileAge('06.10.2000', options.today), 25);
  const result = validateStudentProfile(complete(), options);
  assert.deepEqual(result.errors, {});
  assert.equal(result.value.realLocation, 'Tbilisi, Georgia');
  assert.equal(result.value.desiredLocation, 'Remote');
  assert.equal(result.value.telegramPersonalChatId, '@kira_s');
  assert.equal(result.value.realAge, 26);
});
test('invalid required values, impossible dates and boundary ages cannot be saved', () => {
  for (const [field, bad] of Object.entries({ firstName: 'Kira', lastName: '-Кира', birthDate: '31.02.2000', englishLevelId: '999',
    readyForInterviewInEnglishIn2Months: '', realLocation: 'Тбилиси, Грузия', desiredLocation: 'London', calendarEmail: 'kira@mail.ru', telegramPersonalChatId: 'kira' }))
    assert.ok(validateStudentProfile({ ...complete(), [field]: bad }, options).errors[field], field);
  for (const date of ['2027-01-01', '2016-01-01', '1950-01-01']) assert.ok(validateStudentProfile({ ...complete(), birthDate: date }, options).errors.birthDate);
  for (const date of ['2012-10-05', '1956-10-05']) assert.equal(validateStudentProfile({ ...complete(), birthDate: date }, options).errors.birthDate, undefined);
});
test('education opt out clears values; partial rows and invalid years fail', () => {
  const optedOut = validateStudentProfile({ ...complete(), noHigherEducation: true }, options);
  assert.equal(optedOut.value.educationEntries, null); assert.equal(optedOut.valid, true);
  assert.ok(validateStudentProfile({ ...complete(), educationEntries: [] }, options).errors.educationEntries);
  const partial = validateStudentProfile({ ...complete(), educationEntries: [{ uni: 'Вуз', yearOfEnd: '2022' }] }, options);
  assert.ok(partial.educationErrors['0.faculty']); assert.ok(partial.educationErrors['0.grade']);
  for (const year of ['1959', '2033', '20']) assert.ok(validateStudentProfile({ ...complete(), educationEntries: [{ ...complete().educationEntries[0], yearOfEnd: year }] }, options).errors.educationEntries);
});
test('workplaces preserve current flags and reject duplicates or separator ambiguity', () => {
  const workplaces = [{ companyName: ' Yandex ', isCurrent: true }, { companyName: 'Sber', isCurrent: false }, { companyName: '', isCurrent: false }];
  const result = validateStudentProfile({ ...complete(), workPlaces: workplaces }, options);
  assert.equal(result.valid, true); assert.equal(result.value.workPlaces.length, 2); assert.equal(result.value.workPlaces[0].companyName, 'Yandex');
  for (const rows of [[{ companyName: 'Ozon, Avito' }], [{ companyName: 'Yandex' }, { companyName: 'yandex ' }], [{ companyName: 'a'.repeat(101) }]])
    assert.ok(validateStudentProfile({ ...complete(), workPlaces: rows }, options).errors.workPlaces);
});
test('Russian phone accepts only +7 and ten digits after permitted normalization', () => {
  assert.equal(normalizeRussianPhone('8 (977) 544-21-05'), '+79775442105');
  for (const value of ['8 (977) 544-21-05', '+7 999 123-45-67']) assert.equal(isRussianPhone(value), true);
  for (const value of ['+15551234567', '+7999', 'call +79991234567', '79991234567']) assert.equal(isRussianPhone(value), false);
});

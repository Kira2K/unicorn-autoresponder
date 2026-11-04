import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateStudentProfile, profileAge, profileFullName, isInternationalPhone, normalizeInternationalPhone } from './student-profile-validation.ts';
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
test('education opt out requires other education; higher education needs no city', () => {
  const optedOut = validateStudentProfile({ ...complete(), noHigherEducation: true }, options);
  assert.equal(optedOut.valid, false); assert.ok(optedOut.educationErrors['0.city']);
  assert.equal(validateStudentProfile(complete(), options).valid, true);
  const other = validateStudentProfile({ ...complete(), noHigherEducation: true, educationEntries: [{ uni: 'School', yearOfEnd: '2020', city: 'Москва' }] }, options);
  assert.equal(other.valid, true); assert.equal(other.value.educationEntries[0].city, 'Москва');
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
test('HH contact phone accepts international codes without substituting country code digits', () => {
  assert.equal(normalizeInternationalPhone('8 (977) 544-21-05'), '89775442105');
  assert.equal(normalizeInternationalPhone('+8 (977) 544-21-05'), '+89775442105');
  assert.equal(normalizeInternationalPhone('+856 20 123 456'), '+85620123456');
  for (const value of ['+8 (977) 544-21-05', '+7 999 123-45-67', '+15551234567', '+44 7700 900123',
    '+375291234567', '+380501234567', '+995555123456', '+998901234567', '+85620123456', '+123456', '+123456789012345'])
    assert.equal(isInternationalPhone(value), true, value);
  for (const value of ['', '+', '+7999', '+0123456789', '+1234567890123456', 'call +79991234567', '79991234567', '8 (977) 544-21-05', '++995555123456'])
    assert.equal(isInternationalPhone(value), false, value);
});

test('desired locations accept city-country pairs and Remote anywhere in a semicolon-separated list', () => {
  for (const [input, expected] of [
    ['Barselona, Spain; Paris, France', 'Barselona, Spain; Paris, France'],
    ['Barcelona, Spain; Paris, France; Berlin, Germany', 'Barcelona, Spain; Paris, France; Berlin, Germany'],
    ['  Barselona ,Spain ; Paris, France ; rEmOtE  ', 'Barselona, Spain; Paris, France; Remote'],
    ['remote; New York, United States; REMOTE; Paris,France', 'Remote; New York, United States; Remote; Paris, France'],
    ['remote', 'Remote'],
  ]) {
    const result = validateStudentProfile({ ...complete(), desiredLocation: input }, options);
    assert.equal(result.valid, true, input);
    assert.equal(result.value.desiredLocation, expected);
  }
});

test('desired locations have no count limit and preserve every entry in order', () => {
  const locations = Array.from({ length: 1000 }, (_, index) => index % 2 ? 'Paris, France' : 'Remote');
  const result = validateStudentProfile({ ...complete(), desiredLocation: locations.join(';') }, options);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value.desiredLocation.split('; '), locations);
});

test('each desired location must be complete; real location still accepts one city-country pair', () => {
  for (const desiredLocation of ['', ' ', ';', 'Paris, France;', ';Paris, France', 'Paris, France;;Remote',
    'Paris, France; ; Remote', 'Paris, France; London', 'Paris, France; , Spain', 'Paris, France; Москва, Россия',
    'Paris, France, Remote', 'Remote; Paris, France; Remote work']) {
    assert.ok(validateStudentProfile({ ...complete(), desiredLocation }, options).errors.desiredLocation, desiredLocation);
  }
  assert.ok(validateStudentProfile({ ...complete(), realLocation: 'Paris, France; Berlin, Germany' }, options).errors.realLocation);
});

test('locations accept Latin diacritics and apostrophes without accepting other scripts', () => {
  {
    for (const location of ['São Paulo, Brazil', 'Sa\u0303o Paulo, Brazil', 'L’Haÿ-les-Roses, France', "St. John's, Canada"]) {
      const result = validateStudentProfile({ realLocation: location, desiredLocation: location }, {
        englishLevelIds: [] });
      const expected = true;
      assert.equal(!result.errors.realLocation, expected, location);
      assert.equal(!result.errors.desiredLocation, expected, location);
      assert.equal(result.value.desiredLocation, location);
    }
  }
  const result = validateStudentProfile({ desiredLocation: 'São Paulo, Brazil; Saint John’s, Canada; Remote' }, {
    englishLevelIds: [] });
  assert.equal(result.errors.desiredLocation, undefined);
  for (const location of ['Москва, Russia', 'Αθήνα, Greece', '\u0301Paris, France', 'Paris😀, France'])
    assert.ok(validateStudentProfile({ desiredLocation: location }, { englishLevelIds: [] }).errors.desiredLocation);
});

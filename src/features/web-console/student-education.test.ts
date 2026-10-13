import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateStudentEducation, educationText } from './student-education.ts';

const higher = { uni: 'University', faculty: 'CS', grade: 'Bachelor', yearOfEnd: '2020' };
const other = { uni: ' Колледж связи ', yearOfEnd: '2020', city: ' Москва ' };
test('other education requires institution, graduation year and city and clears higher-only fields', () => {
  const result = validateStudentEducation([{ ...higher, ...other }], true, 2026);
  assert.equal(result.error, '');
  assert.deepEqual(result.value, [{ uni: 'Колледж связи', faculty: '', grade: '', yearOfEnd: '2020', city: 'Москва' }]);
  assert.equal(educationText(result.value), 'Колледж связи, 2020, Москва');
  for (const field of ['uni', 'yearOfEnd', 'city']) {
    const invalid = validateStudentEducation([{ ...other, [field]: ' ' }], true, 2026);
    assert.ok(invalid.errors[`0.${field}`]);
    assert.ok(invalid.error);
  }
  for (const year of ['1959', '2033', '20']) assert.ok(validateStudentEducation([{ ...other, yearOfEnd: year }], true, 2026).error);
  assert.ok(validateStudentEducation([], true, 2026).error);
  assert.ok(validateStudentEducation([other, other], true, 2026).error);
});

test('higher education never requires or retains city and keeps existing required fields', () => {
  assert.equal(validateStudentEducation([higher], false, 2026).error, '');
  assert.deepEqual(validateStudentEducation([{ ...higher, city: 'Москва' }], false, 2026).value, [higher]);
  for (const field of ['uni', 'faculty', 'grade', 'yearOfEnd'])
    assert.ok(validateStudentEducation([{ ...higher, [field]: '' }], false, 2026).errors[`0.${field}`]);
});

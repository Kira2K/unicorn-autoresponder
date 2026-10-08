import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { ClientProfilePatch } from '../backend/types.ts';

// T15/T15a/T16: exercise the real form; the caller intercepts API writes.
export async function checkStudentEducation(page: Page, writes: ClientProfilePatch[]) {
  const byId = (id: string) => page.getByTestId(id);
  const checkbox = byId('no-higher-education');
  const fields = ['uni', 'faculty', 'grade', 'yearOfEnd'];
  const field = (name: string, index = 0) => byId(`profile-education-${name}-${index}`);
  const rows = page.locator('.student-education-row');
  const profile = byId('validated-student-profile');
  const initialWrites = writes.length;
  const entry = { uni: 'Test University', faculty: 'Computer Science', grade: 'Bachelor', yearOfEnd: '2020' };
  const open = () => byId('open-profile-editor-button').click();
  const save = async () => {
    await byId('save-profile-button').click();
    await byId('profile-form').waitFor({ state: 'detached' });
  };
  const assertEmptyRow = async (disabled: boolean) => {
    assert.equal(await rows.count(), 1);
    for (const name of fields) {
      assert.equal(await field(name).inputValue(), '');
      assert.equal(await field(name).isDisabled(), disabled);
    }
    assert.equal(await byId('add-education-button').isDisabled(), disabled);
    assert.equal(await page.getByRole('button', { name: 'Удалить образование 1', exact: true }).isDisabled(), disabled);
  };

  await open();
  await checkbox.uncheck();
  for (const [name, value] of Object.entries(entry)) await field(name).fill(value);
  await byId('add-education-button').click();
  for (const [name, value] of Object.entries(entry)) await field(name, 1).fill(value);
  assert.equal(await rows.count(), 2);
  await checkbox.check();
  await assertEmptyRow(true);
  assert.equal(await profile.getByText('Поля образования заполнять не нужно', { exact: true }).isVisible(), true);
  assert.equal(writes.length, initialWrites, 'toggling alone must not send a write');
  await save();
  assert.equal(writes.length, initialWrites + 1);
  assert.equal(writes.at(-1)!.noHigherEducation, true);
  assert.equal(writes.at(-1)!.education, null);
  assert.equal(writes.at(-1)!.educationEntries, null);
  await page.reload();
  await profile.getByText('Нет высшего образования', { exact: true }).waitFor();
  assert.equal(await profile.locator('.student-incomplete').count(), 0);
  assert.equal(await profile.getByText(entry.uni, { exact: false }).count(), 0);
  await open();
  assert.equal(await checkbox.isChecked(), true);
  await assertEmptyRow(true);

  await checkbox.uncheck();
  await assertEmptyRow(false);
  await byId('save-profile-button').click();
  await byId('profile-validation-summary').waitFor();
  assert.match(await byId('profile-validation-summary').innerText(), /Образование/);
  for (const name of fields) assert.equal(await field(name).getAttribute('aria-invalid'), 'true');
  assert.equal(writes.length, initialWrites + 1, 'T15a: empty education must not be submitted');
  await field('uni').fill(entry.uni);
  await field('yearOfEnd').fill(entry.yearOfEnd);
  await byId('save-profile-button').click();
  for (const name of ['faculty', 'grade']) assert.equal(await field(name).getAttribute('aria-invalid'), 'true');
  assert.equal(writes.length, initialWrites + 1, 'T16: partial education must not be submitted');
  await field('faculty').fill(entry.faculty);
  await field('grade').fill(entry.grade);
  await byId('profile-validation-summary').waitFor({ state: 'detached' });
  await save();
  assert.equal(writes.length, initialWrites + 2);
  assert.equal(writes.at(-1)!.noHigherEducation, false);
  assert.deepEqual(writes.at(-1)!.educationEntries, [entry]);
  await page.reload();
  await profile.getByText(Object.values(entry).join(', '), { exact: true }).waitFor();
  await open();
  assert.equal(await checkbox.isChecked(), false);
  for (const [name, value] of Object.entries(entry)) assert.equal(await field(name).inputValue(), value);
  await page.getByRole('button', { name: 'Удалить образование 1', exact: true }).click();
  await assertEmptyRow(false);
  await checkbox.check();
  await byId('profile-form').getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.reload();
  await profile.getByText(Object.values(entry).join(', '), { exact: true }).waitFor();
  assert.equal(writes.length, initialWrites + 2, 'cancel must preserve saved education');
}

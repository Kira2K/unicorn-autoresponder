import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake, readBlockedAccounts, normalizeBlockedAccounts } from './contracts.mts';
const draft = { scenario: 'new', outlookLogin: 'test@outlook.com', outlookPassword: 'secret', firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi' };
test('Outlook accepts only the exact outlook.com domain', () => {
  for (const login of ['a@gmail.com', 'a@hotmail.com', 'a@outlook.com.evil.com', 'a@sub.outlook.com', 'a@@outlook.com'])
    assert.throws(() => parseIntake({ ...draft, outlookLogin: login }), { code: 'linkedin_intake_outlook_required' });
  assert.equal(parseIntake({ ...draft, outlookLogin: 'a@OUTLOOK.COM' }).outlookLogin, 'a@OUTLOOK.COM');
});
test('Outlook registration timestamp validates calendar dates and requires UTC; omission remains compatible', () => {
  assert.equal(parseIntake(draft).outlookRegisteredAt, undefined);
  assert.equal(parseIntake({ ...draft, outlookRegisteredAt: '2026-10-25T10:30:00.000Z' }).outlookRegisteredAt, '2026-10-25T10:30:00.000Z');
  for (const value of ['bad', '2026-02-30T10:30:00.000Z', '2026-10-25T10:30', 123, '2026-10-25T25:00:00.000Z'])
    assert.throws(() => parseIntake({ ...draft, outlookRegisteredAt: value }), { code: 'linkedin_intake_outlook_registration_invalid' });
});
test('blocked history accepts zero, multiple and partial objects; removes only blank cards', () => {
  assert.deepEqual(parseIntake(draft).blockedAccounts, []);
  const history = [{ fullName: ' First ' }, {}, { company: 'Other', blockedAt: 'long ago' }];
  const saved = normalizeBlockedAccounts(history);
  assert.deepEqual(saved, [{ fullName: 'First' }, { company: 'Other', blockedAt: 'long ago' }]);
  assert.deepEqual(readBlockedAccounts(JSON.stringify(saved)), saved);
});
test('legacy history and unknown text survive a round trip', () => {
  const cards = readBlockedAccounts('Alex Smith\nСтрана: UK\nUnexpected original text');
  assert.equal(cards[0].country, 'UK');
  assert.equal(cards[0].legacyText, 'Unexpected original text');
  assert.deepEqual(readBlockedAccounts(JSON.stringify(cards)), cards);
  const unfamiliar = '[{"old_name":"Keep this legacy data"}]';
  assert.deepEqual(readBlockedAccounts(unfamiliar), [{ legacyText: unfamiliar }]);
});
test('existing credentials require URL and explicit self confirmation', () => {
  assert.throws(() => parseIntake({ scenario: 'existing', url: 'https://linkedin.com/in/alex', login: 'alex' }), { code: 'linkedin_intake_login_confirmation_required' });
  assert.equal(parseIntake({ scenario: 'existing', url: 'linkedin.com/in/alex', login: 'alex', loggedIn: true }).scenario, 'existing');
  assert.throws(() => parseIntake({ ...draft, outlookLogin: 'test@outlook.com.evil.com' }), { code: 'linkedin_intake_outlook_required' });
});

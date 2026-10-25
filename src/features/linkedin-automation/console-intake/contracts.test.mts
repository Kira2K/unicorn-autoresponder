import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake, readBlockedAccounts, normalizeBlockedAccounts } from './contracts.mts';
const draft = { scenario: 'new', outlookLogin: 'test@outlook.com', outlookPassword: 'secret', firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi' };
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake, parseLinkedInResult, readBlockedAccounts, normalizeBlockedAccounts } from './contracts.mts';

test('existing LinkedIn credentials can precede Octo, but completion still requires login confirmation',()=>{
 const account={scenario:'existing',url:'https://linkedin.com/in/test',login:'person@example.com',password:'fixture'};
 assert.equal(parseIntake({...account,stage:'credentials'}).stage,'credentials');
 assert.throws(()=>parseIntake({...account,stage:'complete'}),{code:'linkedin_intake_login_confirmation_required'});
 assert.equal(parseIntake({...account,loggedIn:true}).stage,undefined);
 assert.throws(()=>parseIntake({...account,stage:'unexpected'}),{code:'linkedin_intake_invalid'});
 assert.throws(()=>parseIntake({scenario:'new',stage:'credentials'}),{code:'linkedin_intake_invalid'});
});
const draft = { scenario: 'new', outlookLogin: 'test@outlook.com', outlookPassword: 'secret', firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi' };

test('Outlook registration cannot be in the future; a declared blocked account requires every structured field',()=>{
 const now=Date.parse('2026-10-29T00:00:00.000Z');
 assert.throws(()=>parseIntake({...draft,outlookRegisteredAt:'2026-10-29T00:01:00.000Z'},now),{code:'linkedin_intake_outlook_registration_future'});
 assert.equal(parseIntake({...draft,outlookRegisteredAt:'2026-10-29T00:00:00.000Z'},now).outlookRegisteredAt,'2026-10-29T00:00:00.000Z');
 assert.throws(()=>parseIntake({...draft,hasBlockedAccounts:true,blockedAccounts:[]}),{code:'linkedin_intake_blocked_required'});
 assert.throws(()=>parseIntake({...draft,hasBlockedAccounts:true,blockedAccounts:[{fullName:'Old name'}]}),{code:'linkedin_intake_blocked_required'});
 const blocked={fullName:'Old Name',country:'Georgia',company:'Company',position:'Developer',blockedAt:'2026-10-01'};
 assert.deepEqual(parseIntake({...draft,hasBlockedAccounts:true,blockedAccounts:[blocked]}).blockedAccounts,[blocked]);
});

test('banned-account replacement is explicit, new-scenario only and bound to a positive account ID', () => {
  assert.equal(parseIntake({...draft,replacesLinkedInAccountId:42}).replacesLinkedInAccountId,42);
  for(const replacesLinkedInAccountId of [0,-1,1.5,'42',null])
    assert.throws(()=>parseIntake({...draft,replacesLinkedInAccountId}),{code:'linkedin_intake_replacement_invalid'});
  assert.throws(()=>parseIntake({scenario:'existing',url:'https://linkedin.com/in/test',login:'test',loggedIn:true,replacesLinkedInAccountId:42}),{code:'linkedin_intake_replacement_invalid'});
});

test('LinkedIn result validates URL separately from login and accepts email logins from any domain', () => {
  for (const login of ['student@outlook.com','student@gmail.com','student@company.example']) {
    assert.deepEqual(parseLinkedInResult({url:'https://www.linkedin.com/in/student',login,password:'secret'}),
      {url:'https://www.linkedin.com/in/student',login,password:'secret'});
    assert.throws(() => parseLinkedInResult({url:login,login,password:'secret'}), {code:'linkedin_intake_account_required'});
  }
});
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

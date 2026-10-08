import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNocoDb } = require('../../../platform/db/noco/noco-db.ts');
const { getClientReadinessError } = require('../cli/orchestrator.ts');
const { authorizeHHPage } = require('./make-hh-auth.ts');
const { hhAuthSelectors: selectors } = require('./auth-selectors.ts');

function dbFor(account: Record<string, unknown>) {
  return createNocoDb({ nocoClient: { async fetchRecords(id: string) {
    if (id === 'mxza381054ldlza') return [{ Id: 1, client_name: 'Test', telegram_general_chat_id: '-1' }];
    if (id === 'm8zej2vsv4iypl8') return [{ Id: 2, clients_id: 1, platforms_id: 11, password: 'secret', ...account }];
    return [];
  } } });
}
for (const login of ['person@example.test', '+79990001122']) {
  test(`database and readiness use login without email or phone: ${login}`, async () => {
    const credentials = await dbFor({ login, email: '' }).getHHAuthCredentialsByClientName('Test', 'Ru');
    assert.equal(credentials.login, login);
    assert.equal(getClientReadinessError({ clientName: 'Test', market: 'Ru', commonChatId: '-1',
      stackScenario: 'https://hh.ru/search/vacancy', dolphinProfileId: 123, hhAuthCredentials: credentials }), null);
  });
}
test('email and phone never substitute for a missing login', async () => {
  await assert.rejects(dbFor({ login: ' ', email: 'old@example.test', phone: '+79990001122' })
    .getHHAuthCredentialsByClientName('Test', 'Ru'), /missing login/);
});
test('conflicting email is ignored and malformed login is rejected', async () => {
  const credentials = await dbFor({ login: 'person@example.test', email: 'broken@@email' })
    .getHHAuthCredentialsByClientName('Test', 'Ru');
  assert.equal(credentials.login, 'person@example.test');
  await assert.rejects(dbFor({ login: 'person@example.testperson@example.test', email: 'valid@example.test' })
    .getHHAuthCredentialsByClientName('Test', 'Ru'), /malformed login/);
});

function loginPage(kind: 'email' | 'phone') {
  let submitted = false;
  const fills: Array<{ selector: string; value: string }> = [];
  const loginSelector = kind === 'email' ? selectors.loginForm.email : selectors.loginForm.phoneNumber;
  const exists = (s: string) => submitted
    ? s === selectors.authState.loggedInSignals[0] || s === selectors.navigation.resumesAndProfile
    : [loginSelector, selectors.loginForm.switchToPassword, selectors.loginForm.password].includes(s);
  const locator = (selector: string): any => ({
    first() { return this; },
    async waitFor() { if (!exists(selector) && selector !== selectors.loginForm.submit) throw new Error('absent'); },
    async count() { return exists(selector) ? 1 : 0; },
    locator() { return { first() { return this; }, count: async () => 0 }; },
    async fill(value: string) { fills.push({ selector, value }); },
    async click() { if (selector === selectors.loginForm.submit) submitted = true; }
  });
  return { fills, page: { locator, url: () => submitted ? 'https://hh.ru/search/vacancy' : 'https://hh.ru/account/login',
    title: async () => 'HH', evaluate: async () => false, waitForTimeout: async () => {},
    waitForLoadState: async () => {}, keyboard: { press: async () => {} } } };
}
for (const [kind, login] of [['email', 'person@example.test'], ['phone', '+79990001122']] as const) {
  test(`HH form receives login in ${kind} mode`, async () => {
    const { page, fills } = loginPage(kind);
    const result = await authorizeHHPage(page, { credentials: { login, email: 'wrong@example.test', password: 'secret' }, timeoutMs: 5 });
    assert.equal(result.state, 'logged_in');
    assert.deepEqual(fills.map(f => f.value), [login, 'secret']);
    assert.equal(fills[0].selector, kind === 'email' ? selectors.loginForm.email : selectors.loginForm.phoneNumber);
  });
}

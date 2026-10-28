import assert from 'node:assert/strict';
import type { CycleContext } from './context.mts';
import type { RunJournal } from './journal.mts';
import { cycleDatabase } from './database.mts';

/** Read-back only, including both locales and the actual remote bindings after cleanup. */
export async function auditCompletedCycles(context: CycleContext, journal: RunJournal) {
  if (!journal.data.clientId) throw Error('e2e_fixture_missing');
  const data = await cycleDatabase(context, journal.data.runId, journal.data.clientId).snapshot();
  assert.equal(data.tasks.length, 2); assert.equal(data.accounts.length, 4);
  assert.equal(data.profiles.length, 2); assert.equal(data.cycles.length, 2); assert.equal(data.notices.length, 2);
  assert.ok(data.tasks.every(t => t.status === 'выполнение подтверждено'));
  assert.ok(data.notices.every(n => n.state === 'sent' && Number(n.message_id) > 0));
  const [first, second] = data.tasks;
  for (const key of ['linkedin_account_id', 'outlook_account_id']) {
    assert.notEqual(first[key], second[key]);
    assert.equal(data.accounts.find(a => String(a.id) === String(first[key]))?.__nc_deleted, true);
    const active = data.accounts.find(a => String(a.id) === String(second[key]));
    assert.ok(active); assert.equal(!!active.__nc_deleted, false);
  }
  const firstMail = data.accounts.find(a => String(a.id) === String(first.outlook_account_id));
  const secondMail = data.accounts.find(a => String(a.id) === String(second.outlook_account_id));
  assert.notEqual(firstMail?.login, secondMail?.login);
  assert.equal(data.accounts.find(a => String(a.id) === String(second.linkedin_account_id))?.login, secondMail?.login);
  assert.ok(data.proof.every(p => p.fingerprint && p.exit_ip));
  assert.notEqual(data.proof[0].fingerprint, data.proof[1].fingerprint);
  assert.equal(data.proof[1].comparison, 'different');
  assert.notEqual(data.proof[1].exit_ip, data.proof[1].baseline_ip);
  for (const profile of data.profiles) {
    const remote = await context.cloud.getProfile(profile.state.uuid!);
    assert.ok(remote.title.startsWith('Павел Тестов'));
    assert.equal(remote.title, profile.state.original?.title);
    assert.equal(remote.status, 0);
    // Only the borrowed EN profile underwent cleanup. Untouched RU keeps its initial protection.
    if (profile.state.grant) { assert.equal(profile.state.grant.phase, 'complete'); assert.equal(remote.has_user_password, false); }
  }
  assert.deepEqual(await context.local('/api/profiles/active'), []);
  await journal.record({ step: 'final-readback', expected: 'Два цикла без дублей; оба профиля закрыты и названы кириллицей',
    actual: 'Четыре аккаунта, два архивных; две подтверждённые заявки и две доставки. Новые реквизиты и IP отличаются; EN/RU сверены с облаком.',
    state: 'passed', db: { accounts: 4, archivedAccounts: 2, tasks: 2, cycles: 2, notifications: 2, profiles: 2 } });
}

/** Telegram getChat is read-only. Never send a probe or fall back to a group. */
export async function auditPrivateRecipients(context: CycleContext, journal: RunJournal) {
  const token = context.vars.VEU_SUPPORT_BOT || context.env.VEU_SUPPORT_BOT;
  const kira = context.vars.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID || context.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID;
  if (!token || !kira || !/^\d+$/.test(kira)) throw Error('e2e_private_delivery_config_missing');
  for (const [name, chatId] of [['kira', kira], ['julia', '315110920']]) {
    let ready = false;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getChat`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId }), signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      ready = response.ok && body.ok === true && body.result?.type === 'private' && String(body.result?.id) === chatId;
    } catch { /* No transport errors containing the bot URL are persisted. */ }
    await journal.record({ step: `private-recipient-${name}`, expected: 'Личный чат доступен боту без пробной отправки',
      actual: ready ? 'getChat подтвердил личный чат; PDF ещё не отправлен' : 'Личный чат не подтверждён; нужен диалог с ботом или правильный ID',
      state: ready ? 'passed' : 'blocked' });
  }
}

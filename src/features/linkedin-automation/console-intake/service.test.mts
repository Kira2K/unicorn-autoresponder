import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkedInIntakeService } from './service.mts';
import { mockClient } from '../../octo-access/testing.mts';

test('registration time is required for the pilot client using trusted identity, without affecting other clients', async () => {
  let calendarEmail = 'linkedin-manual-test-20261026@example.invalid', saves = 0;
  const store = { load: async () => ({ url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
    firstName: '', lastName: '', realLocation: '', blockedAccounts: [] }),
    save: async () => { saves++; return { saved: true, linkedinAccountId: 1 }; } };
  const service = createLinkedInIntakeService({ store, allowed: () => true, hasDolphin: async () => false,
    getClient: async id => ({ ...mockClient(id), calendarEmail, market: 'En' }) });
  const data = { scenario: 'new', outlookLogin: 'test@outlook.com', outlookPassword: 'secret',
    firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi', userEmail: 'other@example.com' };
  await assert.rejects(service.save(7, data), { code: 'linkedin_intake_outlook_registration_required' });
  assert.equal(saves, 0);
  await service.save(7, { ...data, outlookRegisteredAt: '2026-10-25T10:30:00.000Z' });
  calendarEmail = 'other@example.com';
  await service.save(7, data);
  assert.equal(saves, 2);
});

test('non-pilot requests retain the old response and cannot write the pilot timestamp', async () => {
  let calendarEmail = 'other@example.com';
  let saved: { outlookRegisteredAt?: string } | undefined;
  const store = { load: async () => ({ url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
    firstName: '', lastName: '', realLocation: '', blockedAccounts: [], outlookRegisteredAt: '2026-10-25T10:30:00.000Z' }),
    save: async (_id: number, data: { outlookRegisteredAt?: string }) => { saved = data; return { saved: true, linkedinAccountId: 1 }; } };
  const service = createLinkedInIntakeService({ store, allowed: () => true, hasDolphin: async () => false,
    getClient: async id => ({ ...mockClient(id), calendarEmail, market: 'En' }) });
  assert.equal('outlookRegisteredAt' in await service.load(7), false);
  const raw = { scenario: 'new', outlookLogin: 'test@outlook.com', outlookPassword: 'secret', firstName: 'Alex',
    lastName: 'Smith', realLocation: 'Tbilisi', outlookRegisteredAt: 'invalid', userEmail: 'linkedin-manual-test-20261026@example.invalid' };
  await service.save(7, raw);
  assert.equal(saved?.outlookRegisteredAt, undefined);
  assert.equal(raw.outlookRegisteredAt, 'invalid', 'caller payload is not mutated');
  calendarEmail = 'linkedin-manual-test-20261026@example.invalid';
  assert.equal((await service.load(7)).outlookRegisteredAt, '2026-10-25T10:30:00.000Z');
  await assert.rejects(service.save(7, raw), { code: 'linkedin_intake_outlook_registration_invalid' });
});
test('intake rejects RU/outside-scope clients and ignores payload client identity', async () => {
  let dolphin = false, market = 'En', savedId = 0;
  const store = { load: async () => ({ url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
    firstName: '', lastName: '', realLocation: '', blockedAccounts: [] }),
    save: async (id: number) => { savedId = id; return { saved: true, linkedinAccountId: 1 }; } };
  const service = createLinkedInIntakeService({ store, allowed: id => id === 7, hasDolphin: async () => dolphin,
    getClient: async id => ({ ...mockClient(id), market }) });
  await assert.rejects(service.load(8), { code: 'forbidden' });
  dolphin = true; await assert.rejects(service.load(7), {code:'linkedin_intake_use_dolphin'});
  dolphin = false; market = 'Ru'; await assert.rejects(service.load(7), { code: 'forbidden' });
  market = 'En';
  await service.save(7, { clientId: 8, scenario: 'new', outlookLogin: 'alex@outlook.com', outlookPassword: 'secret',
    firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi' });
  assert.equal(savedId, 7);
});

test('Dolphin users cannot enter either Octo intake scenario or create tasks', async () => {
  let creation: boolean | undefined;
  const store = { load: async () => ({ url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
    firstName: '', lastName: '', realLocation: '', blockedAccounts: [] }),
    save: async (_id: number, _data: unknown, _locales: string[], options: { createOctoProfiles: boolean }) => {
      creation = options.createOctoProfiles; return { saved: true, linkedinAccountId: 1 };
    } };
  const service = createLinkedInIntakeService({ store, allowed: () => true, hasDolphin: async () => true,
    getClient: async id => ({ ...mockClient(id), market: 'En', commonChatId: '' }) });
  await assert.rejects(service.save(7, { scenario: 'new', outlookLogin: 'alex@outlook.com', outlookPassword: 'secret',
    firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi' }), {code:'linkedin_intake_use_dolphin'});
  assert.equal(creation, undefined);
  await assert.rejects(service.save(7, { scenario: 'existing', url: 'https://linkedin.com/in/alex', login: 'alex', loggedIn: true }),
    { code: 'linkedin_intake_use_dolphin' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkedInIntakeService } from './service.mts';
import { mockClient } from '../../octo-access/testing.mts';

test('omitting blocked-history declaration cannot add partial cards; unchanged legacy history survives',async()=>{
 let writes=0;
 const legacy={fullName:'Old',legacyText:'Original history'};
 const service=createLinkedInIntakeService({allowed:()=>true,hasDolphin:async()=>false,getClient:async id=>({...mockClient(id),market:'En'}),
  store:{load:async()=>({blockedAccounts:[legacy],editableBlockedAccounts:[legacy]}) as any,save:async()=>{writes++;return{saved:true,linkedinAccountId:1};}}});
 const data={scenario:'new',outlookLogin:'test@outlook.com',outlookPassword:'secret',firstName:'Test',lastName:'Student',realLocation:'Tbilisi',outlookRegisteredAt:'2026-10-25T10:30:00.000Z'};
 for(const blockedAccounts of [[{fullName:'New'}],[{...legacy,company:'Changed'}],[legacy,legacy]])
  await assert.rejects(service.save(7,{...data,blockedAccounts}),{code:'linkedin_intake_blocked_required'});
 assert.equal(writes,0);
 await service.save(7,{...data,blockedAccounts:[legacy]});
 assert.equal(writes,1);
});

test('missing Octo client data exposes safe field labels and does not write the intake',async()=>{
 let writes=0;
 const store={load:async()=>({realLocation:''}),save:async()=>{writes++;}} as any;
 const service=createLinkedInIntakeService({store,allowed:()=>true,hasDolphin:async()=>false,getClient:async id=>({...mockClient(id),market:'En',calendarEmail:''})});
 await assert.rejects(service.save(7,{scenario:'new',outlookLogin:'test@outlook.com',outlookPassword:'secret',firstName:'Test',lastName:'Student',realLocation:'Tbilisi',outlookRegisteredAt:'2026-10-25T10:30:00.000Z'}),
  (e:any)=>{assert.equal(e.code,'octo_client_data_required');assert.deepEqual(e.fields,[{field:'calendarEmail',label:'Личный email'}]);return true;});
 assert.equal(writes,0);
});

test('registration time is required and round-trips for every eligible client', async () => {
  let calendarEmail = 'first@example.invalid', saves = 0;
  let saved: { outlookRegisteredAt?: string } = {};
  const store = { load: async () => ({ url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
    firstName: '', lastName: '', realLocation: '', blockedAccounts: [], ...saved }),
    save: async (_id: number, data: { outlookRegisteredAt?: string }) => { saves++; saved = data; return { saved: true, linkedinAccountId: 1 }; } };
  const service = createLinkedInIntakeService({ store, allowed: () => true, hasDolphin: async () => false,
    getClient: async id => ({ ...mockClient(id), calendarEmail, market: 'En' }) });
  const data = { scenario: 'new', outlookLogin: 'test@outlook.com', outlookPassword: 'secret',
    firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi', userEmail: 'other@example.com' };
  for (const email of ['first@example.invalid', 'second@example.invalid']) {
    calendarEmail = email;
    const previousSaves = saves;
    await assert.rejects(service.save(7, data), { code: 'linkedin_intake_outlook_registration_required' });
    await assert.rejects(service.save(7, { ...data, outlookRegisteredAt: 'invalid' }), { code: 'linkedin_intake_outlook_registration_invalid' });
    assert.equal(saves, previousSaves);
    const input = { ...data, outlookRegisteredAt: '2026-10-25T10:30:00.000Z' };
    await service.save(7, input);
    assert.equal((await service.load(7)).outlookRegisteredAt, input.outlookRegisteredAt);
    assert.equal(saves, previousSaves + 1);
  }
  await service.save(7, { scenario: 'existing', url: 'https://linkedin.com/in/alex', login: 'alex', loggedIn: true });
  assert.equal(saved.outlookRegisteredAt, undefined, 'existing LinkedIn does not require Outlook registration time');
});
test('owner reads support Dolphin and RU recovery; normal writes keep market/scope guards and ignore payload identity', async () => {
  let dolphin = false, market = 'En', savedId = 0;
  const store = { load: async () => ({ url: '', login: '', hasPassword: false, outlookLogin: '', hasOutlookPassword: false,
    firstName: '', lastName: '', realLocation: '', blockedAccounts: [] }),
    save: async (id: number) => { savedId = id; return { saved: true, linkedinAccountId: 1 }; } };
  const service = createLinkedInIntakeService({ store, allowed: id => id === 7, hasDolphin: async () => dolphin,
    getClient: async id => ({ ...mockClient(id), market }) });
  await service.load(8);
  dolphin = true; await service.load(7);
  dolphin = false; market = 'Ru'; await service.load(7);
  const fresh={scenario:'new',outlookLogin:'test@outlook.com',outlookPassword:'secret',firstName:'Alex',lastName:'Smith',realLocation:'Tbilisi',outlookRegisteredAt:'2026-10-25T10:30:00.000Z'};
  await assert.rejects(service.save(8,fresh),{code:'forbidden'});
  await assert.rejects(service.save(7,fresh),{code:'forbidden'});
  market = 'En';
  await service.save(7, { clientId: 8, scenario: 'new', outlookLogin: 'alex@outlook.com', outlookPassword: 'secret',
    firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi', outlookRegisteredAt: '2026-10-25T10:30:00.000Z' });
  assert.equal(savedId, 7);
});

test('explicit banned-account replacement supports Dolphin and RU with an EN profile for Denis',async()=>{
  let saved:unknown;
  const store={load:async()=>({url:'https://linkedin.com/in/old',login:'old',hasPassword:true,outlookLogin:'old@outlook.com',hasOutlookPassword:true,firstName:'Alex',lastName:'Smith',realLocation:'Tbilisi',blockedAccounts:[]}),
    save:async(...args:unknown[])=>{saved=args;return{saved:true,linkedinAccountId:42};}};
  const service=createLinkedInIntakeService({store,allowed:()=>true,hasDolphin:async()=>true,getClient:async id=>({...mockClient(id),market:'Ru'})});
  await service.save(7,{scenario:'new',replacesLinkedInAccountId:11,outlookLogin:'new@outlook.com',outlookPassword:'new-secret',
    firstName:'Alex',lastName:'Smith',realLocation:'Tbilisi',outlookRegisteredAt:'2026-10-25T10:30:00.000Z'});
  assert.deepEqual((saved as unknown[])[2],['ru','en']);
  assert.deepEqual((saved as unknown[])[3],{createOctoProfiles:true});
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

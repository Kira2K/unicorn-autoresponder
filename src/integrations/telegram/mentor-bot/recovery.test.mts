import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './test-harness.mts';
import { fixtureClient } from './test-fixtures.mts';
import { createMentorService } from './service.mts';
import { memoryLock, run } from './runtime.mts';
import { tick } from './schedule.mts';
import { DAY, WEEK } from './calendar.mts';

const OPEN = Date.parse('2026-10-22T14:00:00Z');
const apiError = (code: number) => ({ code: 'telegram_bot_api_failed', details: { data: { error_code: code } } });
const update = (id: number, chatId: number) => ({ update_id: id, message: {
  message_id: id, date: 1, chat: { id: chatId, type: 'group' },
  from: { id: 1, username: 'alice', is_bot: false, first_name: 'Synthetic' }, text: '/menu'
} });

for (const errorCode of [400, 403]) {
  test(`permanent membership ${errorCode} skips that update and processes the next chat`, async () => {
    const h = harness(), stop = new AbortController();
    const service = createMentorService({ store: h.store, now: h.now, reportChatId: '-900',
      member: async chatId => { if (chatId === '-999') throw apiError(errorCode); return true; } });
    let polls = 0;
    await run({ store: h.store, lock: memoryLock(), signal: stop.signal, handle: service.handle, send:h.sender,
      maintenance: async () => {}, wait: async () => {}, api: {
        async getUpdates(offset) {
          if (offset === 3 || ++polls > 3) { stop.abort(); return []; }
          return [update(1, -999), update(2, -100)];
        }, async answerCallbackQuery() {}
      } });
    assert.equal(h.store.snapshot().offset, 3);
    assert.equal(Object.keys(h.store.snapshot().sessions).length, 1);
  });
}

test('membership configuration failures remain fatal; temporary failures remain retryable', async () => {
  const h = harness();
  for (const code of [401, 404]) {
    const service = createMentorService({ store: h.store, now: h.now, reportChatId: '-900',
      member: async () => { throw apiError(code); } });
    await assert.rejects(service.handle({ updateId: code, chatId: '-100', username: 'alice', userId: 1, text: '/menu' }));
  }
  for (const code of [429, 503]) {
    const service = createMentorService({ store: h.store, now: h.now, reportChatId: '-900',
      member: async () => { throw apiError(code); } });
    assert.equal((await service.handle({ updateId: code, chatId: '-100', username: 'alice', userId: 1, text: '/menu' })).code, 'unavailable');
  }
  assert.deepEqual(h.store.snapshot().operations, {});
});

test('missing status history isolates one learner without consuming partial history or charging misses', async () => {
  const h = harness([fixtureClient({ status: 'on ru market' }),
    fixtureClient({ id: '2', username: '@bobbb', chatId: '-200', status: 'on ru market' })]);
  const logs: Record<string, unknown>[] = [];
  await tick(h.store, OPEN, '-900');
  await h.store.transaction(s => {
    s.clients['2'].status = 'paused';
    s.sourceEvents.push({ id: 'partial', clientId: '2', oldStatus: 'on ru market', newStatus: 'on en market', at: OPEN + 1 });
  });
  h.setNow(OPEN + WEEK);
  await tick(h.store, h.now(), '-900', event => logs.push(event));
  let state = h.store.snapshot();
  assert.equal(state.learners['1'].recruiterMisses, 1);
  assert.equal(state.learners['2'].recruiterMisses, 0);
  assert.equal(state.learners['2'].status, 'on ru market');
  assert.equal(state.learners['2'].syncError, 'status-history-missing');
  assert.equal(state.operations['status:partial'], undefined);
  assert.equal((await h.command('/menu')).code, 'ok');
  const service = createMentorService({ store: h.store, member: async () => true, now: h.now, reportChatId: '-900' });
  assert.equal((await service.handle({ updateId: 900, chatId: '-200', username: 'mentor', userId: 2, text: '/hard_done' })).code, 'invalid');
  assert.equal(h.store.snapshot().learners['2'].hardCompletedAt, undefined);
  await h.store.transaction(s => s.sourceEvents.push({ id: 'recovered', clientId: '2',
    oldStatus: 'on en market', newStatus: 'paused', at: OPEN + DAY }));
  await tick(h.store, h.now(), '-900', event => logs.push(event));
  state = h.store.snapshot();
  assert.equal(state.learners['2'].syncError, undefined);
  assert.equal(state.learners['2'].status, 'paused');
  assert.equal(state.learners['2'].recruiterMisses, 0);
  assert.ok(state.operations['status:partial']);
  assert.ok(state.operations['status:recovered']);
  assert.deepEqual(logs.map(e => e.code), ['mentor_status_history_required', 'mentor_status_history_recovered']);
});

test('an abandoned old miss report is superseded by the current aggregate during recovery', async () => {
  const h = harness([fixtureClient({ status: 'on ru market' })]);
  await tick(h.store, OPEN + WEEK, '-900');
  await h.store.transaction(s => {
    for (const d of Object.values(s.deliveries)) if (d.id.startsWith('miss:')) {
      d.state = 'sending'; d.claimedAt = OPEN + WEEK; d.attempts = 1;
    }
  });
  h.setNow(OPEN + 3 * WEEK);
  await tick(h.store, h.now(), '-900');
  await h.flush();
  const reports = h.sent.filter(d => d.chatId === '-900');
  assert.equal(reports.length, 1);
  assert.match(reports[0].text, /3 недели/);
});

test('temporary status quarantine defers the current reminder and delivers it after history recovers', async () => {
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(OPEN);
  await tick(h.store,h.now(),'-900');
  await h.store.transaction(s=>{s.clients['1'].status='on en market';});
  await tick(h.store,h.now(),'-900');await h.flush();
  assert.equal(h.sent.length,0);
  assert.equal(Object.values(h.store.snapshot().deliveries)[0].state,'pending');
  await h.store.transaction(s=>{s.sourceEvents.push({id:'market',clientId:'1',oldStatus:'on ru market',newStatus:'on en market',at:OPEN});});
  await tick(h.store,h.now(),'-900');await h.flush();
  assert.equal(h.sent.length,1);
  assert.match(h.sent[0].text,/еженедельный чекин/);
});

test('storage diagnostics preserve safe cause codes without exposing query text or changing outcomes', async () => {
  const h=harness(),events:Record<string,unknown>[]=[];
  const cause=Object.assign(new Error('SECRET_SENTINEL SQL credentials'),{code:'42703'});
  for(const throws of [false,true]){
    const service=createMentorService({store:{async transaction(){throw new Error('mentor_transaction_failed',{cause});}},
      member:async()=>true,now:h.now,reportChatId:'-900',log:event=>{events.push(event);if(throws)throw Error('logger');}});
    assert.equal((await service.handle({updateId:800,chatId:'-100',username:'alice',userId:1,text:'/menu'})).code,'unavailable');
  }
  assert.equal(events.length,2);
  assert.ok(events.every(e=>e.code==='postgres_42703'));
  assert.equal(JSON.stringify(events).includes('SECRET_SENTINEL'),false);
});

test('maintenance failures retain a safe SQLSTATE in runtime logs and still poll without exposing errors',async()=>{
  const h=harness(),stop=new AbortController(),events:Record<string,unknown>[]=[];
  const cause=Object.assign(new Error('SECRET_SENTINEL connection'),{code:'42P01'});
  await run({store:h.store,lock:memoryLock(),signal:stop.signal,handle:h.service.handle,send:h.sender,
    maintenance:async()=>{throw new Error('mentor_transaction_failed',{cause});},
    wait:async()=>{stop.abort();},log:event=>events.push(event),
    api:{async getUpdates(){stop.abort();return [];},async answerCallbackQuery(){}}});
  assert.equal(events[0].reason,'postgres_42P01');
  assert.equal(JSON.stringify(events).includes('SECRET_SENTINEL'),false);
});

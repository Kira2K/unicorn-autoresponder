import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createActionLogListener, type SocketLike } from './action-log.mts';

class FakeSocket extends EventEmitter implements SocketLike {
  close() { this.emit('close'); }
  page(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const page = (id: string, object_id = 'profile-1') => ({ items: [
  { uuid: `event-${id}`, action: 'profiles.started', time: 100, object_id, user_email: 'secret@example.com', object_title: 'secret title', data: { proxy: 'secret' } },
  { uuid: 'ignored', action: 'profiles.proxy_changed', time: 100, object_id },
  { uuid: 'bad', action: 'profiles.stopped', time: 'bad', object_id }
], watermark: { uuid: `cursor-${id}`, time: 100 } });

test('connects to the documented endpoint with token header and filters to safe matching actions', async () => {
  const socket = new FakeSocket(); let args: any; const seen: any[] = [];
  const listener = createActionLogListener({ token: 'top-secret', profileIds: ['profile1'], loadCursor: () => undefined,
    now: () => 90_000_000, connect: (url, opts) => { args = { url, opts }; return socket; },
    onPage: async p => { seen.push(p); } });
  listener.start();
  assert.equal(args.url, 'wss://app.octobrowser.net/api/v2/automation/ws/action_log?from_timestamp=3660');
  assert.deepEqual(args.opts, { headers: { 'X-Octo-Api-Token': 'top-secret' }, followRedirects: false, handshakeTimeout: 10_000 });
  socket.emit('open'); socket.page({ ...page('1'), items: [...page('1').items, page('foreign', 'other').items[0]] });
  await tick();
  assert.deepEqual(seen, [{ events: [{ id: 'event-1', profileId: 'profile-1', action: 'profiles.started', time: 100 }], watermark: { uuid: 'cursor-1', time: 100 } }]);
  assert.equal(JSON.stringify(seen).includes('secret'), false);
  await listener.stop();
});

test('uses persisted cursor on reconnect and processes pages in order', async () => {
  const sockets: FakeSocket[] = []; const urls: string[] = []; const persisted = { uuid: 'saved-id', time: 89_999_000 }; const order: string[] = [];
  const listener = createActionLogListener({ token: 't', profileIds: ['profile-1'], loadCursor: () => persisted,
    now: () => 90_000_000, reconnectMs: 100, connect: url => { urls.push(url); const s = new FakeSocket(); sockets.push(s); return s; },
    onPage: async p => { order.push(p.watermark.uuid); persisted.uuid = p.watermark.uuid; } });
  listener.start(); sockets[0]!.emit('open'); sockets[0]!.page(page('a')); sockets[0]!.page(page('b'));
  await tick(); await tick(); assert.deepEqual(order, ['cursor-a', 'cursor-b']);
  sockets[0]!.emit('close'); await new Promise(r => setTimeout(r, 150));
  assert.equal(sockets.length, 2); assert.match(urls[0]!, /after_uuid=saved-id/); assert.match(urls[1]!, /after_uuid=cursor-b/);
  await listener.stop();
});

test('callback failure reconnects from external cursor without advancing or skipping queued pages', async () => {
  const sockets: FakeSocket[] = []; let cursor = 'old'; let calls = 0; let reconnectUrl = '';
  const listener = createActionLogListener({ token: 't', profileIds: ['profile-1'], loadCursor: () => ({ uuid: cursor, time: 90_000 }),
    now: () => 90_000_000, reconnectMs: 100, connect: url => { reconnectUrl = url; const s = new FakeSocket(); sockets.push(s); return s; },
    onPage: async p => { calls++; if (calls === 1) throw new Error('sensitive detail'); cursor = p.watermark.uuid; } });
  listener.start(); sockets[0]!.emit('open'); sockets[0]!.page(page('a')); sockets[0]!.page(page('b'));
  await new Promise(r => setTimeout(r, 150));
  assert.equal(sockets.length, 2); assert.match(reconnectUrl, /after_uuid=old/); assert.equal(calls, 1);
  assert.equal(listener.status().lastSafeError, 'page_callback_failed');
  await listener.stop();
});

test('bounds malformed input and reports only safe unexpected response status; stop cancels retries', async () => {
  const sockets: FakeSocket[] = []; const listener = createActionLogListener({ token: 't', profileIds: [], loadCursor: () => undefined,
    now: () => 90_000_000, reconnectMs: 100, connect: () => { const s = new FakeSocket(); sockets.push(s); return s; }, onPage: async () => {} });
  listener.start(); sockets[0]!.emit('message', Buffer.from('email=hidden@example.com')); sockets[0]!.emit('unexpected-response', {}, { statusCode: 403 });
  assert.equal(listener.status().lastSafeError, 'http_403');
  assert.equal(JSON.stringify(listener.status()).includes('hidden'), false);
  await listener.stop(); await new Promise(r => setTimeout(r, 150)); assert.equal(sockets.length, 1);
});

test('complete-history mode replays instead of advancing past a malformed relevant event',async()=>{
  const sockets:FakeSocket[]=[],urls:string[]=[],seen:any[]=[];
  const listener=createActionLogListener({token:'t',profileIds:['profile1'],includeUpdates:true,requireCompleteHistory:true,
    loadCursor:()=>({uuid:'persisted',time:90000}),now:()=>90_000_000,reconnectMs:100,
    connect:url=>{urls.push(url);const socket=new FakeSocket();sockets.push(socket);return socket;},onPage:async p=>{seen.push(p);}});
  listener.start();sockets[0].emit('open');sockets[0].page(page('invalid'));
  await new Promise(r=>setTimeout(r,150));
  assert.equal(seen.length,0);assert.equal(sockets.length,2);assert.match(urls[1],/after_uuid=persisted/);
  sockets[1].emit('open');sockets[1].page({...page('valid'),items:[page('valid').items[0]]});
  await tick();assert.equal(seen.length,1);await listener.stop();
});

test('history checkpoint is unavailable while page persistence is pending and advances across queued pages',async()=>{
  const socket=new FakeSocket();let release!:()=>void;let callbacks=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const listener=createActionLogListener({token:'t',profileIds:['profile1'],loadCursor:()=>({uuid:'saved',time:90000}),
    now:()=>90_000_000,connect:()=>socket,onPage:async()=>{callbacks++;await gate;}});
  listener.start();assert.equal(listener.status().checkpoint,undefined);
  socket.emit('open');const before=listener.status().checkpoint!;assert.equal(typeof before,'number');
  socket.page({...page('one'),items:[page('one').items[0]]});
  assert.equal(callbacks,1);assert.equal(listener.status().checkpoint,undefined);
  socket.page({...page('two'),items:[page('two').items[0]]});
  assert.equal(listener.status().checkpoint,undefined);
  release();await tick();
  assert.equal(callbacks,2);assert.ok(listener.status().checkpoint!>before);
  const persisted=listener.status().checkpoint!;
  // Even a page with no matching events invalidates an older checkpoint.
  socket.page({...page('foreign'),items:[page('foreign','other').items[0]]});
  assert.equal(listener.status().checkpoint,undefined);await tick();
  assert.ok(listener.status().checkpoint!>persisted);
  await listener.stop();assert.equal(listener.status().checkpoint,undefined);
});

test('disconnect, reconnect and socket errors invalidate old history checkpoints',async()=>{
  const sockets:FakeSocket[]=[];
  const listener=createActionLogListener({token:'t',profileIds:['profile1'],loadCursor:()=>({uuid:'saved',time:90000}),
    now:()=>90_000_000,reconnectMs:100,connect:()=>{const socket=new FakeSocket();sockets.push(socket);return socket;},onPage:async()=>{}});
  listener.start();sockets[0].emit('open');const original=listener.status().checkpoint!;
  sockets[0].emit('close');assert.equal(listener.status().checkpoint,undefined);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(sockets.length,2);assert.equal(listener.status().checkpoint,undefined);
  sockets[1].emit('open');assert.ok(listener.status().checkpoint!>original);
  sockets[1].emit('error',new Error('private socket failure'));
  assert.equal(listener.status().connected,false);assert.equal(listener.status().checkpoint,undefined);
  assert.equal(listener.status().lastSafeError,'websocket_error');await listener.stop();
});

test('complete-history malformed pages never produce an available checkpoint or persist their watermark',async()=>{
  const socket=new FakeSocket();let calls=0;
  const listener=createActionLogListener({token:'t',profileIds:['profile1'],includeUpdates:true,requireCompleteHistory:true,
    loadCursor:()=>({uuid:'saved',time:90000}),now:()=>90_000_000,connect:()=>socket,onPage:async()=>{calls++;}});
  listener.start();socket.emit('open');assert.equal(typeof listener.status().checkpoint,'number');
  socket.page(page('invalid'));assert.equal(listener.status().checkpoint,undefined);assert.equal(calls,0);
  await listener.stop();
});

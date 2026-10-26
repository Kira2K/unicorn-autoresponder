import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {harness} from './test-harness.mts';
import {fixtureClient} from './test-fixtures.mts';
import {prepareWelcome,pinWelcomes} from './bootstrap.mts';
import {tick} from './schedule.mts';
import {WEEK} from './calendar.mts';
import {run} from './runtime.mts';
test('offline CLI ignores configured production-like secrets and cannot call fetch or sockets',()=>{
  const cli=new URL('./cli.mts',import.meta.url).href;
  const script=`import net from 'node:net';import tls from 'node:tls';
    const deny=()=>{throw new Error('NETWORK_FORBIDDEN');};
    net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;tls.connect=deny;globalThis.fetch=deny;
    process.argv=['node','offline','--demo'];await import(${JSON.stringify(cli)});`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',
    env:{...process.env,MENTOR_BOT_API_KEY:'SECRET_SENTINEL',VEU_SUPPORT_BOT:'SECRET_SENTINEL',APP_DB:'postgres'}});
  assert.equal(r.status,0,r.stderr);
  const out=JSON.parse(r.stdout.trim());
  assert.equal(out.mode,'offline');assert.equal(out.telegramRequests,0);assert.equal(out.databaseConnections,0);
  assert.equal((r.stdout+r.stderr).includes('SECRET_SENTINEL'),false);
});
test('welcome is prepared once and pinned only after confirmed delivery; no implicit installer sends',async()=>{
  const h=harness();
  await prepareWelcome(h.store,h.now());await prepareWelcome(h.store,h.now());
  assert.equal(Object.keys(h.store.snapshot().deliveries).length,1);assert.equal(h.sent.length,0);
  const pins:number[]=[];
  const pin=async(_chat:string,id:number)=>{pins.push(id);};
  await pinWelcomes(h.store,pin);assert.equal(pins.length,0);
  await h.flush();await pinWelcomes(h.store,pin);await pinWelcomes(h.store,pin);
  assert.equal(pins.length,1);assert.equal(h.sent.length,1);
});
test('expired reminders are cancelled even if delivery runs without a scheduler pass',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  const at=Date.parse('2026-10-22T14:00:00Z');
  await tick(h.store,at,'-900');h.setNow(at+WEEK);
  await h.flush();
  assert.equal(h.sent.length,0);
  assert.equal(Object.values(h.store.snapshot().deliveries)[0].state,'cancelled');
});
test('lost worker lock stops polling and releases its connection',async()=>{
  const h=harness();let calls=0,released=false;
  await assert.rejects(run({store:h.store,send:h.sender,api:{async getUpdates(){calls++;return [];},async answerCallbackQuery(){}},
    lock:{async acquire(){return true;},async assertHeld(){throw Error('lost');},async release(){released=true;}},
    signal:new AbortController().signal,maintenance:async()=>{},handle:h.service.handle}),/lost/);
  assert.equal(calls,0);assert.equal(released,true);
});
test('permanent Telegram polling errors stop the worker without blind retries',async()=>{
  const h=harness();let calls=0;
  const lock={async acquire(){return true;},async assertHeld(){},async release(){}};
  await assert.rejects(run({store:h.store,send:h.sender,lock,signal:new AbortController().signal,maintenance:async()=>{},
    api:{async getUpdates(){calls++;throw {code:'telegram_bot_api_failed',details:{data:{error_code:401}}};},
      async answerCallbackQuery(){}},handle:h.service.handle}),/configuration_failed/);
  assert.equal(calls,1);
});

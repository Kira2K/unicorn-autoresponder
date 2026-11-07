const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solveCaptcha } = require('./solve.ts');
function fixture() {
  let present = true, id = 'first', time = 0;
  const calls = [];
  return {calls, setId: x => { id = x; }, setPresent: x => { present = x; },
    adapters: {now: () => time, sleep: async ms => { time += ms; },
      present: async () => present, english: async () => calls.push('english'),
      capture: async () => ({id, bytes: Buffer.from(id)}),
      save: async image => calls.push('save:'+image.id),
      recognize: async () => 'word pair',
      fill: async text => calls.push('fill:'+text),
      submit: async () => { calls.push('submit'); present = false; }} };
}
test('saves the image before recognition and submits a fresh answer', async () => {
  const f = fixture();
  assert.equal((await solveCaptcha(f.adapters)).solved, true);
  assert.deepEqual(f.calls, ['english','save:first','fill:word pair','submit']);
});
test('changed challenge is never filled with the stale OCR answer', async () => {
  const f = fixture();let n = 0;
  f.adapters.recognize = async () => { if (++n === 1) f.setId('second'); return 'fresh words'; };
  const result = await solveCaptcha(f.adapters);
  assert.equal(result.solved, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(f.calls, ['english','save:first','save:second','fill:fresh words','submit']);
});
test('repeated captcha retries within a finite budget', async () => {
  const f = fixture();let n = 0;
  f.adapters.submit = async () => { f.calls.push('submit'); f.setId('challenge'+(++n)); };
  const result = await solveCaptcha(f.adapters, {maxAttempts:2,timeoutMs:10000});
  assert.equal(result.solved, false);
  assert.equal(result.attempts, 2);
  assert.equal(f.calls.filter(x=>x==='submit').length, 2);
});
test('missing/invalid recognition does not submit anything', async () => {
  const f = fixture(); f.adapters.recognize = async () => '';
  const result = await solveCaptcha(f.adapters, {maxAttempts:1});
  assert.equal(result.solved, false);
  assert.equal(f.calls.includes('submit'), false);
});
test('late recognition after timeout cannot fill or submit the page', async () => {
  const f = fixture(); let complete;
  f.adapters.recognize = () => new Promise(resolve => { complete = resolve; });
  const result = await solveCaptcha(f.adapters, {timeoutMs:15});
  assert.equal(result.reason, 'captcha_timeout');
  complete('late words'); await Promise.resolve();
  assert.equal(f.calls.some(x=>x.startsWith('fill:')||x==='submit'),false);
});
test('uncertain submission failure does not trigger another submission', async () => {
  const f = fixture();
  f.adapters.submit = async () => { f.calls.push('submit'); throw Error('unknown outcome'); };
  const result = await solveCaptcha(f.adapters);
  assert.equal(result.reason,'captcha_adapter_error');
  assert.equal(f.calls.filter(x=>x==='submit').length,1);
});
test('navigation after acceptance may lose click acknowledgement; absent challenge confirms resolution',async()=>{
 const f=fixture();f.adapters.submit=async()=>{f.calls.push('submit');f.setPresent(false);throw Error('execution context destroyed')};
 const result=await solveCaptcha(f.adapters);
 assert.equal(result.solved,true);assert.equal(f.calls.filter(x=>x==='submit').length,1);
});

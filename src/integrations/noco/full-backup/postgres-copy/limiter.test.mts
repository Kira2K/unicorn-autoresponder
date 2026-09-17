import test from 'node:test'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNocoRequestLimiter } = require('../../core/request-limiter.ts') as {
  createNocoRequestLimiter(options: { now(): number; sleep(ms: number): Promise<void>; log(): void }): {
    schedule<T>(kind: 'read', action: () => Promise<T>): Promise<T>;
  };
};
test('four completed requests including slow errors, eighth/ninth, Retry-After', async () => {
  let time=0; const starts: number[]=[], ends: number[]=[];
  const queue = createNocoRequestLimiter({ now:()=>time, sleep:async ms=>{time+=ms;},log:()=>{} });
  await Promise.allSettled(Array.from({length:10},(_,i)=>queue.schedule('read',async()=>{
    starts[i]=time; time+=i===3?4500:10; ends[i]=time;
    if(i===3) throw new Error('test');
    if(i===6) throw Object.assign(new Error('limited'),{response:{status:429,headers:{'retry-after':'41'}}});
    return i;
  })));
  assert.ok(starts[4]-ends[3]>=1000); assert.ok(starts[8]-ends[7]>=1000);
  assert.ok(starts[7]-ends[6]>=41000);
});

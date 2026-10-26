import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-harness.mts';
import {fixtureClient,START} from './test-fixtures.mts';
import {tick} from './schedule.mts';
import {WEEK,DAY} from './calendar.mts';
const OPEN=Date.parse('2026-10-22T14:00:00Z');
async function change(h:ReturnType<typeof harness>,status:string,at:number,id:string){
  await h.store.transaction(s=>{
    const old=s.clients['1'].status;s.clients['1'].status=status;
    s.sourceEvents.push({id,clientId:'1',oldStatus:old,newStatus:status,at});
  });
}
test('first period, Monday internal-only report, incomplete draft and Thursday misses',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  await tick(h.store,OPEN-1,'-900');assert.equal(Object.keys(h.store.snapshot().checkins).length,0);
  await tick(h.store,OPEN,'-900');await tick(h.store,OPEN,'-900');
  let s=h.store.snapshot();assert.equal(Object.keys(s.checkins).length,1);
  const ch=Object.values(s.checkins)[0];assert.equal(ch.start,OPEN-WEEK);assert.equal(ch.closesAt,OPEN+WEEK);
  h.setNow(OPEN);await h.command('/menu');await h.click('checkin');await h.click('yes');await h.click('confirm');
  await tick(h.store,OPEN+4*DAY-5*3600000,'-900');
  await tick(h.store,OPEN+4*DAY-5*3600000,'-900');
  s=h.store.snapshot();
  assert.equal(Object.values(s.deliveries).filter(d=>d.id.startsWith('monday:')).length,1);
  assert.equal(Object.values(s.deliveries).find(d=>d.id.startsWith('monday:'))!.input.chatId,'-900');
  assert.equal(s.learners['1'].recruiterMisses,0);assert.equal(Object.values(s.checkins)[0].state,'open');
  await tick(h.store,OPEN+WEEK,'-900');await tick(h.store,OPEN+WEEK,'-900');
  s=h.store.snapshot();assert.equal(s.learners['1'].recruiterMisses,1);assert.equal(s.learners['1'].interviewMisses,1);
  assert.equal(s.checkins[ch.id].result,undefined);assert.equal(Object.keys(s.sessions).length,0);
});
test('multiweek recovery counts once, produces one latest miss report and no historical reminder burst',async()=>{
  const h=harness([fixtureClient({status:'on en market'})]);
  const at=OPEN+5*WEEK;
  await tick(h.store,at,'-900');await tick(h.store,at,'-900');
  const s=h.store.snapshot();
  assert.equal(s.learners['1'].recruiterMisses,5);
  assert.equal(Object.values(s.checkins).length,6);
  assert.equal(Object.values(s.deliveries).filter(d=>d.id.startsWith('miss:')).length,1);
  assert.equal(Object.values(s.deliveries).filter(d=>d.id.startsWith('reminder:')).length,1);
});
test('pause cancels open checkin without penalty and resumes at next Thursday preserving counters',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  await tick(h.store,OPEN+WEEK,'-900');
  const pause=OPEN+WEEK+DAY,resume=OPEN+4*WEEK+DAY;
  await change(h,'paused',pause,'1');await change(h,'on en market',resume,'2');
  await tick(h.store,resume,'-900');
  let s=h.store.snapshot();assert.equal(s.learners['1'].recruiterMisses,1);
  assert.equal(s.learners['1'].nextOpenAt,OPEN+5*WEEK);
  assert.equal(Object.values(s.checkins).filter(c=>c.state==='cancelled').length,1);
  await tick(h.store,OPEN+5*WEEK,'-900');
  s=h.store.snapshot();assert.equal(s.learners['1'].recruiterMisses,1);
  assert.equal(Object.values(s.checkins).filter(c=>c.state==='open').length,1);
});

test('after pause, studying keeps checkins stopped and preparation resumes without resetting the cycle on market entry',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  await tick(h.store,OPEN+WEEK,'-900');
  const activation=h.store.snapshot().learners['1'].activatedAt;
  await change(h,'paused',OPEN+WEEK+DAY,'1');
  await change(h,'studying',OPEN+2*WEEK+DAY,'2');
  await tick(h.store,OPEN+3*WEEK,'-900');
  let s=h.store.snapshot();
  assert.equal(s.learners['1'].active,false);assert.equal(s.learners['1'].nextOpenAt,undefined);
  assert.equal(s.learners['1'].recruiterMisses,1);
  assert.equal(Object.values(s.checkins).filter(ch=>ch.state==='open').length,0);
  await change(h,'hh_en process',OPEN+4*WEEK+DAY,'3');
  await tick(h.store,OPEN+5*WEEK,'-900');
  s=h.store.snapshot();
  assert.equal(s.learners['1'].active,true);assert.equal(s.learners['1'].recruiterMisses,1);
  const preparationCheckin=Object.values(s.checkins).find(ch=>ch.state==='open')!;
  assert.equal(preparationCheckin.end,OPEN+5*WEEK);
  await change(h,'on en market',OPEN+5*WEEK+DAY,'4');
  await tick(h.store,OPEN+5*WEEK+DAY,'-900');
  s=h.store.snapshot();
  assert.equal(s.checkins[preparationCheckin.id].state,'open');
  assert.equal(s.learners['1'].active,true);assert.equal(s.learners['1'].nextOpenAt,OPEN+6*WEEK);
  assert.equal(s.learners['1'].activatedAt,activation);assert.equal(s.learners['1'].recruiterMisses,1);
  await tick(h.store,OPEN+6*WEEK,'-900');
  assert.equal(h.store.snapshot().learners['1'].recruiterMisses,2);
  assert.equal(Object.values(h.store.snapshot().checkins).filter(ch=>ch.state==='open').length,1);
});
test('preparation and market statuses allow the full checkin cycle; other statuses stop it',async()=>{
  for(const status of ['hh_ru process','hh_en process','hh_both process','on ru market','on en market']){
    const h=harness([fixtureClient({status})]);
    await tick(h.store,OPEN+WEEK,'-900');h.setNow(OPEN+WEEK);await h.flush();
    let s=h.store.snapshot();
    assert.equal(s.learners['1'].active,true,status);assert.equal(s.learners['1'].recruiterMisses,1,status);
    assert.ok(Object.values(s.deliveries).some(d=>d.id.startsWith('reminder:')&&d.state==='sent'),status);
    assert.ok(Object.values(s.deliveries).some(d=>d.id.startsWith('miss:')&&d.state==='sent'),status);
    await h.command('/menu');assert.equal((await h.click('checkin')).code,'ok',status);
    await h.click('no');await h.click('confirm');await h.click('no');await h.click('confirm');
    s=h.store.snapshot();
    assert.equal(s.learners['1'].recruiterMisses,0,status);assert.equal(s.learners['1'].interviewMisses,0,status);
    const ch=Object.values(s.checkins).find(ch=>ch.state==='open')!;
    assert.equal(ch.result?.recruiters,false,status);assert.equal(ch.result?.interviews,false,status);
    assert.ok(Object.values(s.deliveries).some(d=>d.template?.type==='checkin-report'&&d.state==='sent'),status);
  }
  for(const status of ['studying','test','','unknown']){
    const stopped=harness([fixtureClient({status:'on ru market'})]);
    await tick(stopped.store,OPEN+WEEK,'-900');
    await change(stopped,status,OPEN+WEEK+DAY,'1');await tick(stopped.store,OPEN+8*WEEK,'-900');
    const s=stopped.store.snapshot();
    assert.equal(s.learners['1'].active,false,status);
    assert.equal(s.learners['1'].recruiterMisses,1,status);
    assert.equal(Object.values(s.checkins).filter(ch=>ch.state==='open').length,0,status);
    assert.ok(Object.values(s.deliveries).filter(d=>d.id.startsWith('miss:')||d.id.startsWith('reminder:')).every(d=>d.state==='cancelled'),status);
    stopped.setNow(OPEN+8*WEEK);
    assert.notEqual((await stopped.command('/menu')).code,'unavailable');
    assert.notEqual((await stopped.click('checkin')).code,'ok',status);
  }
  const inactive=harness([fixtureClient({status:'test'})]);await tick(inactive.store,OPEN+10*WEEK,'-900');
  assert.equal(Object.keys(inactive.store.snapshot().checkins).length,0);
});
test('previously inactive preparation starts from the next checkin without historical penalties',async()=>{
  for(const status of ['hh_ru process','hh_en process','hh_both process']){
    const h=harness([fixtureClient({status})]);
    await h.store.transaction(s=>{
      const l=s.learners['1'];l.active=false;delete l.activatedAt;delete l.nextOpenAt;
    });
    const now=OPEN+8*WEEK+DAY;
    await tick(h.store,now,'-900');await tick(h.store,now,'-900');
    let s=h.store.snapshot();
    assert.equal(s.learners['1'].active,true,status);assert.equal(s.learners['1'].activatedAt,now,status);
    assert.equal(s.learners['1'].nextOpenAt,OPEN+9*WEEK,status);
    assert.equal(s.learners['1'].recruiterMisses,0,status);assert.equal(s.learners['1'].interviewMisses,0,status);
    assert.equal(Object.keys(s.checkins).length,0,status);
    await tick(h.store,OPEN+9*WEEK,'-900');s=h.store.snapshot();
    assert.equal(Object.values(s.checkins)[0].start,OPEN+8*WEEK,status);
    assert.equal(s.learners['1'].recruiterMisses,0,status);
  }
});

test('exclusion exactly at Thursday wins over penalty; completed history survives',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  await tick(h.store,OPEN,'-900');await change(h,'paused',OPEN+WEEK,'1');await tick(h.store,OPEN+WEEK,'-900');
  assert.equal(h.store.snapshot().learners['1'].recruiterMisses,0);
  assert.equal(Object.values(h.store.snapshot().checkins)[0].state,'cancelled');
});
test('pitch reminders use original hard completion anchor, resume without a burst and stop on market',async()=>{
  const h=harness();await h.command('/hard_done','mentor');await h.click('confirm','mentor');
  await tick(h.store,START+4*WEEK,'-900');
  assert.equal(Object.values(h.store.snapshot().deliveries).filter(d=>d.id.startsWith('pitch:')).length,2);
  h.setNow(START+4*WEEK+DAY);await h.command('/ready_pitch');await h.click('yes');await h.click('confirm');
  await h.click('edit');await h.click('no');await h.click('confirm');
  await tick(h.store,h.now(),'-900');assert.equal(Object.values(h.store.snapshot().deliveries).filter(d=>d.id.startsWith('pitch:')).length,2);
  await tick(h.store,START+5*WEEK,'-900');assert.equal(Object.values(h.store.snapshot().deliveries).filter(d=>d.id.startsWith('pitch:')).length,4);
  await change(h,'on ru market',START+5*WEEK+1,'1');await tick(h.store,START+8*WEEK,'-900');
  assert.equal(Object.values(h.store.snapshot().deliveries).filter(d=>d.id.startsWith('pitch:')).length,4);
});

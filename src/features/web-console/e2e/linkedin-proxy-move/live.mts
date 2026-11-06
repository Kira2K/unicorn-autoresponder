import assert from 'node:assert/strict';
import {createOctoApi} from '../../../octo-access-test/octo-api.mts';
import {assertFixture} from '../linkedin-full-cycle/contracts.mts';
import {waitForCycle,readJson} from '../linkedin-full-cycle/ui.mts';
import type {CycleContext} from '../linkedin-full-cycle/context.mts';
import type {RunJournal} from '../linkedin-full-cycle/journal.mts';
import type {Page} from 'playwright';
import type {ManagedProfile} from '../../../octo-access/contracts.mts';
import type {Move} from '../../../linkedin-automation/proxy-move/contracts.mts';
import {runProxyMoveFlow} from './flow.mts';
import {unusedTestProxy} from '../../../linkedin-automation/local-console/test-proxy.mts';
export async function proxyMoveTestInput(c:CycleContext){
  const uuid=c.env.LINKEDIN_PROXY_MOVE_TEST_PROXY_UUID;if(!uuid||!/^[a-f0-9]{32}$/i.test(uuid))throw Error('e2e_proxy_move_test_proxy_required');
  const rows=await c.rawCloud.cloudRequest('/proxies');
  const reserved=await c.read(async s=>(await s.query("SELECT profile_id FROM noco.octo_profiles WHERE state->'proxy'->>'uuid'=$1 OR state->'proxyChange'->>'uuid'=$1 LIMIT 1",[uuid])).rows.length>0);
  return unusedTestProxy(rows,uuid,reserved?new Set([uuid]):new Set());
}
export async function runLiveProxyMove(c:CycleContext,journal:RunJournal,page:Page){
  if(!journal.data.clientId)throw Error('e2e_fixture_missing');
  const id=journal.data.clientId;
  await c.read(async s=>{const row=(await s.query('SELECT * FROM noco.clients WHERE id=$1',[id])).rows[0];assertFixture(row,journal.data.runId,'auto');});
  const answer=c.env.LINKEDIN_PROXY_MOVE_TEST_ENGLISH_READY||'Yes';if(!['Yes','No'].includes(answer))throw Error('e2e_proxy_move_survey_answer_invalid');
  const profileUpdate=await page.context().request.patch(c.consoleUrl+'/api/client/me',{data:{readyForInterviewInEnglishIn2Months:answer}});
  if(!profileUpdate.ok())throw Error('e2e_proxy_move_survey_update_failed');
  const old=await readJson(page.context(),'/api/client/linkedin-proxy-move');
  const input=old.move?{type:'socks5' as const,host:'resume.invalid',port:1080,login:'',password:''}:await proxyMoveTestInput(c);
  const result=await runProxyMoveFlow(page,input,async()=>{
    const state=await readJson(page.context(),'/api/client/linkedin-proxy-move');
    const p=await c.read(async s=>(await s.query('SELECT * FROM noco.octo_profiles WHERE client_id=$1 AND profile_id=$2',[id,state.profileId])).rows[0]);
    const profile=p?.state as ManagedProfile|undefined;
    if(!profile||profile.locale!=='en')throw Error('e2e_proxy_move_binding_changed');
    const desktop=createOctoApi(c.vars.OCTO_API_TOKEN!,fetch,{debugPort:true});
    if((await desktop.activeProfiles()).length)throw Error('e2e_desktop_has_active_profiles');
    if(String((await c.local('/api/username')).username).toLowerCase()!==c.vars.OCTO_GUEST_EMAIL?.toLowerCase())throw Error('e2e_guest_desktop_required');
    await page.getByTestId('linkedin-proxy-move').getByRole('button',{name:'Получить доступ',exact:true}).click();
    let grant:any;
    await waitForCycle(async()=>{const s=await readJson(page.context(),'/api/octo/profiles/status');const en=s.profiles.find((x:any)=>x.id===state.profileId);if(!en?.grantId)return false;grant=await readJson(page.context(),`/api/octo/grants/${en.grantId}`);return grant.phase==='granted'&&!!grant.password;},'e2e_grant_timeout');
    const marker=`proxy-move-open:${state.move.id}`;
    if(journal.data.checks.some(e=>e.step===marker))throw Error('e2e_open_outcome_requires_review');
    await journal.record({step:marker,state:'blocked',expected:'Одно открытие тестового EN',actual:'Попытка зафиксирована до Desktop'});
    let opened=false,stopAttempted=false;
    try{await desktop.startProfile(profile.uuid!,grant.password);opened=true;assert.ok((await desktop.activeProfiles()).includes(profile.uuid!));
      stopAttempted=true;await c.local('/api/profiles/stop',{uuid:profile.uuid});
      await waitForCycle(()=>c.read(async s=>(await s.query("SELECT state->'grant'->>'phase' AS phase FROM noco.octo_profiles WHERE profile_id=$1 AND client_id=$2",[state.profileId,id])).rows[0]?.phase==='complete'),'e2e_cleanup_timeout',300000);
      const cloud=await c.cloud.getProfile(profile.uuid!);assert.equal(cloud.status,0);assert.equal(cloud.has_user_password,false);
      const record=journal.data.checks.find(e=>e.step===marker)!;record.state='passed';record.actual='Desktop открыл профиль; обычное закрытие и cleanup подтверждены';await journal.save();
    }finally{if(opened&&!stopAttempted)await c.local('/api/profiles/stop',{uuid:profile.uuid});}
  });
  const proof=await c.read(async s=>{const rows=(await s.query('SELECT id,data,notice_state,message_id FROM noco.linkedin_proxy_move WHERE client_id=$1 AND account_id=$2',[id,(await readJson(page.context(),'/api/client/linkedin-intake')).linkedinAccountId])).rows;
    assert.equal(rows.length,1);assert.equal((rows[0].data as Move).phase,'completed');return{id:rows[0].id,noticeState:rows[0].notice_state};});
  await journal.record({step:'proxy-move',state:'passed',expected:'Один переезд тестового аккаунта',actual:'Назначение, доступ и завершение проверены. Страна LinkedIn и пересылка писем требуют ручной проверки.',db:proof});return result;
}

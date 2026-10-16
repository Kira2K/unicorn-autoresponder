import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {workflowFixture} from './workflow-fixture.mts';
import {workflowEnv,workflowScenario} from './workflow-scenario.mts';
import {isFinalCvStatus} from '../../../../integrations/telegram/resume-final-status.ts';
import {selectFinalEnglishCv} from '../../../linkedin-automation/profile-filler/generation/cv-source.ts';
const bot=createRequire(import.meta.url)('../../../../integrations/telegram/resume-workflow.ts');
test('CV done: RU/EN/both flows end at the single final status with approvals intact',async()=>{
  for(const market of ['Ru','En','both'])for(const mode of ['legacy','sql'] as const){
    const f=workflowFixture(market),restore=workflowEnv([7]);
    try{const result=await workflowScenario(f[mode],market);const w=await f[mode].getResumeWorkflowById(result.workflowId);
      assert.equal(w!.status,'CV done');assert.equal(bot.statusResponsibility(w!.status),'done');
    }finally{restore();}
  }
});
test('rolling upgrade keeps old final reads but never treats a draft or unknown state as final',()=>{
  for(const status of ['CV done','moved to filling','filled'])assert.equal(isFinalCvStatus(status),true);
  for(const status of ['finished','Draft in process','','unknown'])assert.equal(isFinalCvStatus(status),false);
  assert.equal(selectFinalEnglishCv([{Id:1,clients_id:7,status:'CV done',en_version_url:'https://example.invalid/final'}],7).url,'https://example.invalid/final');
});

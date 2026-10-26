import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const preload=fileURLToPath(new URL('./regression-preload.cjs',import.meta.url));
const suites=[
  {name:'telegram integration',args:['src/integrations/telegram/integration.test.ts']},
  {name:'telegram routes',args:['src/features/web-console/backend/telegram-integration-routes.test.ts']},
  {name:'support bot',args:['src/integrations/telegram/support-bot.test.ts']},
  {name:'support workflow state',args:['--test','src/integrations/telegram/resume-rejection-history.test.ts','src/integrations/telegram/resume-workflow-state.test.ts']},
  {name:'CV mock e2e',mock:true,args:['src/integrations/telegram/resume-visible-e2e.test.ts']},
  {name:'client lifecycle',args:['--test','src/features/client-lifecycle/*.test.ts','src/features/client-lifecycle/*.test.mts']},
];
for(const suite of suites){
  const result=spawnSync(process.execPath,['--require',preload,...suite.args],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:180_000,maxBuffer:16*1024*1024,
    env:{...process.env,MENTOR_REGRESSION_MOCK_CONSOLE:suite.mock?'1':'0'}
  });
  if(result.status!==0){
    console.error(suite.name+': FAILED');
    console.error(result.stdout);console.error(result.stderr);
    process.exitCode=1;break;
  }
  console.log(suite.name+': passed (isolated)');
}

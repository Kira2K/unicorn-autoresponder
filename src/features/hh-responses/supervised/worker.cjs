const fs=require('node:fs'),path=require('node:path');
const {applyRuntimeEnvironment,writeJson}=require('./services.cjs');
const {checkTargetChats}=require('./check-target-chats.cjs');
const {marketFlag}=require('./market-flags.cjs');
async function main(){
  const config=JSON.parse(process.env.HH_RUN_CONFIG),market=process.argv[2],dir=process.argv[3];
  if(!['Ru','En'].includes(market)||!path.isAbsolute(dir)||path.dirname(dir)!==path.join(config.root,'logs'))throw Error('hh_worker_arguments_invalid');
  applyRuntimeEnvironment(config,market);require('./db-read-retry.cjs').install();
  const cli=require('../cli/orchestrator.ts'),dolphin=require('../../../integrations/dolphin/runtime.ts');
  let cancelled=false,stopping;
  const stop=()=>{
    if(cancelled)return;cancelled=true;cli.requestOrchestratorStop();
    // The worker's existing started-profile set is the ownership boundary.
    stopping=dolphin.stopStartedProfiles();void stopping.catch(()=>{});
  };
  process.on('message',message=>{if(message?.type==='stop')stop();});
  process.on('disconnect',stop);
  const manifest={market,workerPid:process.pid,at:new Date().toISOString(),ledger:cli.getLocalRunLogFile(),responseLimit:config.responseLimit,concurrency:config.concurrency};
  const file=path.join(dir,`manifest-${market}.json`);writeJson(file,manifest);
  const {loadReadinessResults}=require('../../../integrations/noco/hh-response-readiness/index.ts');
  const {hhReadinessOptions}=require('../../../platform/db/postgres/hh-readiness.mts');
  let rows=await loadReadinessResults({market,...(config.clientNames.length?{clientNames:config.clientNames}:{}),...hhReadinessOptions('postgres',cli.createHHAppDb())});
  const {createTelegramBotApi}=require('../../../integrations/telegram/bot-api.ts');
  rows=await checkTargetChats(rows,createTelegramBotApi({requestTimeoutMs:10000}),proof=>writeJson(path.join(dir,`chats-${market}.json`),proof));
  const ready=cli.splitPrelaunchReadinessTargets(rows);
  if(cancelled)throw Error('hh_run_cancelled');
  const delivery=await require('../orchestrator/telegram-reporting.ts').sendPrelaunchReadinessLog({market,responseLimit:config.responseLimit,...ready});
  Object.assign(manifest,ready,{readinessDelivery:delivery});writeJson(file,manifest);
  if(!delivery.sent)throw Error('hh_readiness_delivery_unconfirmed');
  if(!ready.readyTargets.length)return;
  process.env.ORCHESTRATOR_CLIENT_NAMES=[...new Set(ready.readyTargets.map(t=>t.clientName))].join(',');
  const {loadRuntimePostgresReader}=require('../../../platform/db/postgres/runtime.mts');
  await cli.main({beforeClientStart:async client=>{
    if(cancelled)return false;
    const target=ready.readyTargets.find(t=>t.dolphinProfileId===client.dolphinProfileId&&t.clientName===client.clientName);
    if(!target)throw Error('hh_ready_target_identity_changed');
    return (await marketFlag(await loadRuntimePostgresReader(),target.clientId,market)).enabled;
  }});
}
if(require.main===module)main().then(()=>process.exit(0)).catch(error=>{
  console.error(/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_worker_failed');process.exit(1);
});
module.exports={main};

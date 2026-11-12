const path=require('node:path'),fs=require('node:fs');
const {checkServices}=require('./service-checks.cjs');
const {checkTargetChats}=require('./check-target-chats.cjs');
async function preflight(config,recognizer) {
  const {createTelegramBotApi}=require('../../../integrations/telegram/bot-api.ts');
  const {requestLocalDolphin}=require('../../../integrations/dolphin/local-api.ts');
  const {requestDolphinCloudApi}=require('../../../integrations/dolphin/cloud-api.ts');
  const {assertDolphinAppRunning,getRunningDolphinBrowserProfileIds}=require('../../../integrations/dolphin/preflight.ts');
  const checks=[
    {name:'runner_state',run:async()=>{
      const pids=require('./lease.cjs').otherHhProcesses();
      if(config.mode==='full'&&pids.length)throw Error('hh_other_runner_active');
      return {otherRunnerPids:pids};
    }},
    {name:'runtime',run:async()=>{
      const [major,minor]=process.versions.node.split('.').map(Number);
      if(major<24||major===24&&minor<12)throw Error('hh_node_version_unsupported');
      if(process.platform!=='win32')throw Error('hh_windows_runner_required');
      require('sharp');require('../../../platform/browser/playwright.ts').loadPlaywright();
      return {node:process.versions.node,platform:process.platform};
    }},
    {name:'postgres',timeoutMs:45000,run:async()=>{
      const {readPostgresAppDbConfig}=require('../../../platform/db/postgres/config.mts');
      const {createPostgresPool}=require('../../../integrations/postgres/pg-pool.mts');
      const {createPostgresClient}=require('../../../integrations/postgres/working-client.mts');
      const {TABLES}=require('../../../integrations/noco/core/schema.ts');
      const settings=readPostgresAppDbConfig(process.env),pool=createPostgresPool(settings);
      try{
        const db=await createPostgresClient(pool,settings.database),table=db.listTables().find(t=>t.id===TABLES.hhAutoresponses.id);
        if(!table||!['Делаем_отклики_Ru','Делаем_отклики_En','clients_id'].every(k=>table.columns.some(c=>c.dataKey===k)))throw Error('hh_flags_schema_missing');
        await db.listRecords(table.id,{limit:1});return {storage:'postgres',schemaVerified:true};
      }finally{await pool.end();}
    }},
    {name:'dolphin',timeoutMs:45000,run:async()=>{
      await assertDolphinAppRunning();await requestDolphinCloudApi('/browser_profiles/statuses');
      const registry=await requestLocalDolphin('/browser_profiles/running',{timeoutMs:5000});
      const ids=[...new Set([...Object.keys(registry).map(Number),...getRunningDolphinBrowserProfileIds()])];
      if(config.mode==='full'&&ids.length)throw Error('hh_dolphin_profiles_not_idle');
      return {local:true,cloud:true,runningProfileIds:ids};
    }},
    {name:'report_destinations',timeoutMs:45000,run:async()=>{
      if(!/^-?\d+$/.test(config.reportsChat)||!/^\-?\d+$/.test(config.technicalChat))throw Error('hh_report_destination_missing');
      const rows=await checkTargetChats([...new Set([config.reportsChat,config.technicalChat])].map(commonChatId=>({commonChatId,problems:[]})),createTelegramBotApi({requestTimeoutMs:10000}));
      if(rows.some(r=>r.problems.length))throw Error('hh_report_destination_unavailable');
      return {summaryChatId:config.reportsChat,technicalChatId:config.technicalChat,canSend:true};
    }},
    {name:'codex',timeoutMs:config.recognitionTimeoutMs+30000,run:async signal=>{
      const info=await recognizer.inspect();
      if(config.mode==='inspect')return {...info,inferenceTested:false};
      const probe=await recognizer.selfTest(signal);return {...info,inferenceTested:true,...probe};
    }}
  ];
  return checkServices(checks);
}
function applyRuntimeEnvironment(config,market) {
  Object.assign(process.env,{APP_DB:'postgres',summary_logs_channel_id:config.reportsChat,logs_channel_id:config.technicalChat,
    HH_SUPERVISED_RUN:'true',
    ORCHESTRATOR_SUPERVISED:'true',ORCHESTRATOR_CONCURRENCY:String(config.concurrency),ORCHESTRATOR_RESPONSE_LIMIT:String(config.responseLimit),
    ORCHESTRATOR_WATCH_MS:String(config.watchMs),ORCHESTRATOR_IDLE_TIMEOUT_MS:String(config.idleTimeoutMs),
    DOLPHIN_HEADLESS:'false',DOLPHIN_KEEP_PROFILE_OPEN_AFTER_RUN:'false',DOLPHIN_PREFLIGHT_AUTO_CLEANUP:'false'});
  for(const key of ['ORCHESTRATOR_CLIENT_IDS','ORCHESTRATOR_CLIENT_NAMES','ORCHESTRATOR_EXCLUDE_CLIENT_IDS','ORCHESTRATOR_EXCLUDE_CLIENT_NAMES','ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES','ORCHESTRATOR_CONTINUE_FROM_LOG'])delete process.env[key];
  if(market)process.env.ORCHESTRATOR_WORK_WITH_MARKET=market;
}
async function deliverStateReport(config,text){
  if(!config.reportsChat)return {sent:false,kind:'configuration'};
  const {telegramForReports}=require('../../../integrations/telegram/index.ts');
  const result=await telegramForReports(config.reportsChat).sendOne({chatId:config.reportsChat,text});
  if(result.kind==='telegram-response'&&result.response.ok&&String(result.response.result.chat.id)===config.reportsChat)return {sent:true,kind:result.kind,chatId:config.reportsChat,messageId:result.response.result.message_id};
  return {sent:false,kind:result.kind,...(result.kind==='telegram-response'?{errorCode:result.response.error_code}:{stage:result.failure.stage})};
}
async function sendStateReport(config,text){return (await deliverStateReport(config,text)).sent;}
function writeJson(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.writing';fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file);}
module.exports={preflight,applyRuntimeEnvironment,sendStateReport,deliverStateReport,writeJson};

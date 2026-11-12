const path = require('node:path');
function assertNodeVersion(version=process.versions.node){
  const [major,minor]=version.split('.').map(Number);
  if(major<24||major===24&&minor<12)throw Error('hh_node_version_unsupported');
}
function configuration(args = [], env = process.env, root = path.resolve(__dirname, '../../../..')) {
  const values = new Map();
  for (let i=0;i<args.length;i++) {
    const match=args[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match) throw Error('invalid_hh_option');
    const key=match[1];
    if (!['markets','limit','concurrency','client-names','env-file','mode','allow-weekend'].includes(key)||values.has(key)) throw Error('invalid_hh_option');
    const value=match[2]??(key==='allow-weekend'?'true':args[++i]);
    if(!value||value.startsWith('--')) throw Error('invalid_hh_option');
    values.set(key,value);
  }
  const number=(value,fallback,max)=>{const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('invalid_hh_limit');return n;};
  const selected=String(values.get('markets')??env.HH_MARKETS??'ru,en').toLowerCase().split(',');
  if(selected.some(x=>!['ru','en'].includes(x))||new Set(selected).size!==selected.length)throw Error('invalid_hh_markets');
  const markets=['ru','en'].filter(x=>selected.includes(x)).map(x=>x==='ru'?'Ru':'En');
  const mode=values.get('mode')??'full';if(!['full','inspect'].includes(mode))throw Error('invalid_hh_check_mode');
  if(env.APP_DB&&env.APP_DB!=='postgres')throw Error('hh_supervised_requires_postgres');
  const reportsChat=String(env.HH_REPORTS_CHAT_ID||env.summary_logs_channel_id||'').trim();
  const technicalChat=String(env.HH_TECHNICAL_CHAT_ID||reportsChat).trim();
  const clientNames=String(values.get('client-names')??'').split(',').map(x=>x.trim()).filter(Boolean);
  const config={root,markets,mode,clientNames,reportsChat,technicalChat,
    responseLimit:number(values.get('limit')??env.HH_RESPONSE_LIMIT,100,1000),
    concurrency:number(values.get('concurrency')??env.HH_CONCURRENCY,4,20),
    maxCalls:number(env.HH_RECOGNITION_MAX_CALLS,200,10000),tokenBudget:number(env.HH_RECOGNITION_TOKEN_BUDGET,1500000,100000000),
    reserveTokens:number(env.HH_RECOGNITION_RESERVE_TOKENS,20000,1000000),
    recognitionTimeoutMs:number(env.HH_RECOGNITION_TIMEOUT_MS,90000,90000),
    startupTimeoutMs:number(env.HH_STARTUP_TIMEOUT_MS,900000,3600000),
    campaignTimeoutMs:number(env.HH_CAMPAIGN_TIMEOUT_MS,86400000,129600000),
    watchMs:number(env.ORCHESTRATOR_WATCH_MS,7200000,14400000),idleTimeoutMs:number(env.ORCHESTRATOR_IDLE_TIMEOUT_MS,600000,7200000),
    model:env.HH_CAPTCHA_MODEL||'gpt-6.1-sol',reasoning:env.HH_CAPTCHA_REASONING||'high',
    executable:env.HH_CODEX_EXECUTABLE||null,timeZone:env.HH_TIME_ZONE||'Europe/Moscow',
    allowWeekend:values.get('allow-weekend')==='true'};
  if(config.reserveTokens>config.tokenBudget)throw Error('invalid_hh_token_reservation');
  return config;
}
function weekdayAllowed(config,now=new Date()) {
  return config.allowWeekend||['Mon','Tue','Wed','Thu'].includes(new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:config.timeZone}).format(now));
}
function loadConfiguration(args=process.argv.slice(2), env=process.env,root=path.resolve(__dirname,'../../../..')) {
  assertNodeVersion();
  // Resolve just this option before loading dotenv; never execute ENV contents.
  const inline=args.find(x=>x.startsWith('--env-file='));const i=args.indexOf('--env-file');
  const envFile=inline?.slice(11)??(i>=0?args[i+1]:path.join(root,'.env'));
  if(!envFile||envFile.startsWith('--'))throw Error('invalid_env_file');
  const loaded=require('dotenv').config({path:envFile,quiet:true});
  if(loaded.error&&(inline||i>=0))throw Error('hh_env_file_unavailable');
  return configuration(args,env,root);
}
module.exports={configuration,loadConfiguration,weekdayAllowed,assertNodeVersion};

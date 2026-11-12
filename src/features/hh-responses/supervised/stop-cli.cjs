const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {setMarketFlag,marketFlag}=require('./market-flags.cjs');
function parseStop(args){
  const map=new Map();
  for(let i=0;i<args.length;i++){
    const m=args[i].match(/^--(client-name|market|env-file|disable|enable)(?:=(.*))?$/);
    if(!m||map.has(m[1]))throw Error('hh_stop_arguments_invalid');
    const value=m[2]??(['enable','disable'].includes(m[1])?'true':args[++i]);if(!value||value.startsWith('--')||['enable','disable'].includes(m[1])&&value!=='true')throw Error('hh_stop_arguments_invalid');map.set(m[1],value);
  }
  if(!map.get('client-name')||!['ru','en'].includes(map.get('market'))||map.has('enable')===map.has('disable'))throw Error('hh_stop_arguments_invalid');
  return {clientName:map.get('client-name').trim(),market:map.get('market')==='ru'?'Ru':'En',enabled:map.has('enable'),envFile:map.get('env-file')};
}
async function main(args=process.argv.slice(2)){
  require('./config.cjs').assertNodeVersion();
  const options=parseStop(args),root=path.resolve(__dirname,'../../../..');
  const loaded=require('dotenv').config({path:options.envFile??path.join(root,'.env'),quiet:true});if(loaded.error&&options.envFile)throw Error('hh_env_file_unavailable');
  if(process.env.APP_DB&&process.env.APP_DB!=='postgres')throw Error('hh_supervised_requires_postgres');
  const config=require('../../../platform/db/postgres/config.mts').readPostgresAppDbConfig(process.env),pool=require('../../../integrations/postgres/pg-pool.mts').createPostgresPool(config);
  try{
    const {createPostgresClient}=require('../../../integrations/postgres/working-client.mts'),{TABLES}=require('../../../integrations/noco/core/schema.ts');
    const db=await createPostgresClient(pool,config.database,{writable:true});
    const matches=await db.findRecords(TABLES.clients.id,'client_name',[options.clientName],{trim:true,limit:10});
    if(matches.nextKey||matches.records.length!==1)throw Error('hh_stop_client_ambiguous');
    const clientId=Number(matches.records[0].data.Id);
    const result=await setMarketFlag(db,{...options,clientId});
    const verified=await marketFlag(db,clientId,options.market);if(verified.enabled!==options.enabled)throw Error('hh_flag_verification_failed');
    const dir=path.join(root,'logs/hh-flag-changes');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,randomUUID()+'.json'),JSON.stringify({at:new Date().toISOString(),...result,verified:true},null,2));
    console.log(JSON.stringify({...result,verified:true}));
  }finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error(/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_flag_change_failed');process.exitCode=1;});
module.exports={main,parseStop};

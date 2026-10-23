const path=require('node:path');
const common=require('../telegram-group-restoration/live.cjs');
const {ROOT,REPO,read,save,sleep,openDb,Api,bi,FOLDER}=common;
const {STACKS:definitions,ACCOUNTS}=require('./policy.cjs');
const OUT=path.join(REPO,'storage/stack-restoration-20261023'),DATA=path.join(ROOT,'stack-restoration-20261023');
const file=name=>path.join(OUT,name+'.json');
const scope=read(file('source-scope'))||read(file('manifest'))?.stacks||[];
const STACKS=definitions.map(s=>({key:s.key,name:s.name,sourceChatId:scope.find(t=>t.key===s.key)?.sourceChatId,sqlStackIds:s.sqlStackIds}));
function report(event,details={}){console.log(JSON.stringify({at:new Date().toISOString(),event,...details}));}
function status(phase,extra={}){save(file('status'),{at:new Date().toISOString(),pid:process.pid,phase,...extra});report(phase,extra);}
async function rows(id){const db=await openDb();try{await db.query('BEGIN READ ONLY');const result=(await db.query('SELECT c.id,c.client_name,c.client_status,c.telegram_personal_chat_id,c.telegram_general_chat_id,to_jsonb(c)->>\'secured_general_chat_id\' AS secured_general_chat_id,to_jsonb(c)->>\'secured_general_chat_invitation_link\' AS secured_general_chat_invitation_link,c."01_stacks_id" AS stack_id FROM noco.clients c WHERE coalesce(c.__nc_deleted,false)=false'+(id?' AND c.id=$1':''),id?[id]:[])).rows;await db.query('ROLLBACK');return result;}finally{await db.end();}}
async function actor(key){const {useLocalWss}=require('../telegram-group-restoration/local-wss.cjs');const c=useLocalWss(key==='source'?require('../telegram-group-restoration/audit-additional-sources.cjs').openObserver('support'):common.openCreator(key==='owner'?'unicorn':'kira'));await c.connect();const me=await c.getMe();if(String(me.id)!==ACCOUNTS[key]){await c.disconnect();throw Error('stack_account_identity_mismatch');}return c;}
function lock(name){return require(ROOT+'/tools/restoration-lock.cjs').acquireLock(name);}
function manifest(){if(STACKS.some(s=>!/^-[0-9]+$/.test(s.sourceChatId||'')))throw Error('local_stack_source_scope_required');let m=read(file('manifest'));if(m){if(JSON.stringify(m.stacks)!==JSON.stringify(STACKS))throw Error('stack_manifest_scope_changed');return m;}const {monthCutoff}=require(ROOT+'/tools/runtime.cjs');m={version:1,createdAt:new Date().toISOString(),upperDate:Math.floor(Date.now()/1000),cutoff:monthCutoff(),stacks:STACKS,ownerId:ACCOUNTS.owner,sourceId:ACCOUNTS.source,observerId:ACCOUNTS.observer};save(file('manifest'),m);return m;}
module.exports={...common,OUT,DATA,file,report,status,rows,actor,lock,manifest,STACKS,ACCOUNTS};

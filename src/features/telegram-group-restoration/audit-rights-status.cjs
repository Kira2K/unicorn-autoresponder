// Read-only Telegram audit. Never retries grants, joins or ownership transfers.
const path=require('node:path');
const {ROOT,FOLDER,REPO,read,save,openCreator,Api,bi,sleep}=require('./live.cjs');
async function main(){
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));
 const result={at:new Date().toISOString(),readOnly:true,accounts:[],ownership:[],supportSamples:[]};
 const code=e=>/^[\w:-]{1,120}$/.test(String(e.errorMessage||e.code||e.message))?String(e.errorMessage||e.code||e.message):'read_audit_failed';
 async function inspect(c,id){
  const state=read(path.join(FOLDER,'client-'+id+'.json'));
  const r=await c.invoke(new Api.channels.GetParticipants({channel:new Api.InputChannel({channelId:bi(state.channel.id),accessHash:bi(state.channel.accessHash)}),filter:new Api.ChannelParticipantsAdmins(),offset:0,limit:100,hash:bi(0)}));
  return {clientId:id,chatId:state.chatId,ownerId:String(r.participants.find(p=>p.className==='ChannelParticipantCreator')?.userId||''),supportAdmin:r.participants.some(p=>String(p.userId)==='8222949251')};
 }
 try{
  for(const key of ['local','unicorn','kira']){
   let c;try{
    c=openCreator(key);await c.connect();const me=await c.getMe();result.accounts.push({key,id:String(me.id),readAuthorized:true});
    const targets=key==='local'?read(path.join(FOLDER,'transfer-local-groups.json')).targets.map(t=>t.clientId):key==='unicorn'?['76','128']:['9'];
    for(const id of targets){try{const row=await inspect(c,id);(key==='local'?result.ownership:result.supportSamples).push(row);}catch(e){(key==='local'?result.ownership:result.supportSamples).push({clientId:id,error:code(e),seconds:e.seconds});if(e.errorMessage==='FLOOD'||e.errorMessage?.startsWith('FLOOD_WAIT_'))break;}await sleep(4000);}
   }catch(e){result.accounts.push({key,error:code(e),seconds:e.seconds});}finally{await c?.disconnect();}
   save(path.join(REPO,'storage/group-restoration-additional/rights-status-audit.json'),result);
  }
 }finally{release();}
 console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(e=>{console.error(e.code||'rights_audit_failed');process.exitCode=1;});

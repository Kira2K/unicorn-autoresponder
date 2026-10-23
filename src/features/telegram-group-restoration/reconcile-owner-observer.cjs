const path=require('node:path');
const {FOLDER,ROOT,read,save,openCreator,sleep}=require('./live.cjs');
async function main(id){
 const target=read(path.join(FOLDER,'transfer-local-groups.json')).targets.find(t=>t.clientId===id);if(!target)throw Error('observer_scope_missing');
 const receipt=path.join(FOLDER,'transfer-client-'+id+'.json');if(!read(receipt)?.intentAt||read(receipt).done||read(receipt).blocked)throw Error('observer_not_pending');
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock')),c=openCreator('unicorn');
 try{await c.connect();const originalInvoke=c.invoke.bind(c);c.invoke=require('./read-rpc-gate.cjs').createReadGate({invoke:originalInvoke,sleep,onWait:r=>{save(path.join(FOLDER,'ownership-observer-status.json'),{at:new Date().toISOString(),status:'waiting_read_limit',...r});console.log(JSON.stringify({event:'observer_read_wait',method:r.method,seconds:r.seconds}));}});
  await c.getDialogs({limit:300});const result=await require('./transfer-timur.cjs').execute(read(path.join(FOLDER,'client-'+id+'.json')),{client:c,scope:target,receipt,reconcileOnly:true});
  save(path.join(FOLDER,'transfer-client-'+id+'-status.json'),{at:new Date().toISOString(),clientId:id,status:result.done?'complete':'blocked',error:result.error,reconciled:true});
  const completed=read(path.join(FOLDER,'transfer-local-groups.json')).targets.filter(t=>read(path.join(FOLDER,'transfer-client-'+t.clientId+'.json'))?.done).length;
  save(path.join(FOLDER,'transfer-local-groups-status.json'),{at:new Date().toISOString(),status:'stopped',reason:'source_read_flood',groups:10,completed,pending:10-completed});const value={clientId:id,done:!!result.done,reconciled:true,completed};console.log(JSON.stringify(value));return value;
 }catch(e){const value={error:e.errorMessage||e.code||'observer_failed',method:e.rpcMethod,seconds:e.seconds};console.error(JSON.stringify(value));save(path.join(FOLDER,'ownership-observer-status.json'),{at:new Date().toISOString(),...value,...(e.seconds?{notBefore:Date.now()+(e.seconds+1)*1000}:{})});return value;}finally{await c.disconnect();release();}
}
async function run(){for(let i=0;i<3;i++){const value=await main(process.argv[2]);if(value.done)return;if(value.error==='FLOOD'&&value.seconds>0&&value.seconds<=60){await sleep((value.seconds+1)*1000);continue;}process.exitCode=1;return;}process.exitCode=1;}
if(require.main===module)run().catch(e=>{console.error(e.code||'observer_failed');process.exitCode=1;});

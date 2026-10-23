const path=require('node:path');
const {FOLDER,read,save,openCreator,Api,bi,report}=require('./live.cjs'),{hash}=require('./plan.cjs');
async function inspect(){const c=openCreator('kira'),results=[];try{await c.connect();if(String((await c.getMe()).id)!=='7586552066')throw Error('creator_mismatch');for(const id of ['11','55']){
 const plan=read(path.join(FOLDER,'plans.json')).find(p=>p.clientId===id),s=read(path.join(FOLDER,'client-'+id+'.json'));
 const peer=new Api.InputPeerChannel({channelId:bi(s.channel.id),accessHash:bi(s.channel.accessHash)}),rows=[];
 for await(const m of c.iterMessages(peer,{}))if(m.className==='Message')rows.push(m);
 const byId=new Map(rows.map(m=>[m.id,m])),knownIds=new Set(),differences=[];
 for(const op of plan.operations){const d=s.deliveries[op.key];knownIds.add(d.result.messageId);const m=byId.get(d.result.messageId);if(!m){differences.push({key:op.key,code:'missing'});continue;}
  if(hash(m.message||'')!==op.hash){const actual=m.message||'';let i=0;while(i<actual.length&&i<op.text.length&&actual[i]===op.text[i])i++;differences.push({key:op.key,messageId:m.id,expectedLength:op.text.length,actualLength:actual.length,firstDifference:i,expectedCodes:Array.from(op.text.slice(Math.max(0,i-5),i+12)).map(x=>x.codePointAt(0)),actualCodes:Array.from(actual.slice(Math.max(0,i-5),i+12)).map(x=>x.codePointAt(0)),trimMatches:actual===op.text.trim(),crlfMatches:actual===op.text.replace(/\r/g,'')});}
 }
 const marker='#src_'+plan.sourceChatId.replace(/\D/g,'')+'_';
 const extras=rows.filter(m=>!knownIds.has(m.id)&&m.message?.includes(marker)).map(m=>({messageId:m.id,senderId:String(m.senderId),length:m.message.length}));
 results.push({clientId:id,operations:plan.operations.length,actualMessages:rows.length,differences,extras});
 }save(path.join(FOLDER,'incomplete-inspection.json'),results);report('incomplete_inspection',{groups:results});}finally{await c.disconnect();}}
if(require.main===module)inspect().catch(e=>{report('inspection_failed',{code:e.errorMessage||e.code||'inspection_failed'});process.exitCode=1;});

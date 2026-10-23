const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {buildPlan}=require('./plan.cjs');
function loadPlans(root){
 const tools=root+'/tools',{ordinary}=require(tools+'/history.cjs'),{parts}=require(tools+'/pilot-contract.cjs');
 const db=new DatabaseSync(root+'/archive/archive.sqlite',{readOnly:true});
 try{
  const cutoff=JSON.parse(fs.readFileSync(root+'/runtime/restoration/client-92-plan.json')).cutoff;
  const users=new Map(db.prepare('SELECT id,payload FROM users').all().map(r=>[r.id,JSON.parse(r.payload)]));
  return db.prepare('SELECT chat_id,payload,complete FROM groups').all().map(row=>{
   if(!row.complete)throw Error('archive_incomplete_'+row.chat_id);
   const group=JSON.parse(row.payload);
   const messages=db.prepare('SELECT payload,pinned FROM messages WHERE chat_id=?').all(row.chat_id).map(r=>({...JSON.parse(r.payload),pinned:!!r.pinned})).filter(ordinary);
   return buildPlan({group,messages,users,cutoff,renderParts:parts,media:f=>{
    const stored=db.prepare('SELECT * FROM media WHERE key=?').get(f.uniqueId||'file_'+f.fileId);
    if(stored?.state!=='complete')throw Error('attachment_incomplete');
    const absolute=path.resolve(root+'/archive',stored.path),base=path.resolve(root+'/archive')+path.sep;
    if(!absolute.startsWith(base)||!fs.existsSync(absolute)||fs.statSync(absolute).size!==stored.bytes)throw Error('attachment_invalid');
    if(stored.bytes>50000000)throw Error('attachment_upload_limit');
    return {path:absolute,name:path.basename(f.name||absolute).replace(/[\r\n]/g,'_'),bytes:stored.bytes,sha256:stored.sha256};
   }});
  });
 }finally{db.close();}
}
module.exports={loadPlans};

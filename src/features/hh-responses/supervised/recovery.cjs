const TAG='Автоотклики, не трогай';
function ownedProfiles(rows){
  const owned=new Map();
  for(const row of rows){
    if(row.kind!=='client-lifecycle')continue;
    if(['automation profile lock verified','automation profile lock planned'].includes(row.event?.event)){
      const match=row.event.details?.match(/^status (\d+), previous (null|\d+)$/);
      if(match)owned.set(Number(row.dolphinProfileId),{id:Number(row.dolphinProfileId),lockStatus:Number(match[1]),previous:match[2]==='null'?null:Number(match[2])});
    }
  }
  return [...owned.values()].filter(p=>Number.isSafeInteger(p.id)&&p.id>0);
}
async function recoverOwnedProfiles(rows,{readProfile,readRunning,stop,removeTag,restoreStatus},apply=false){
  const results=[];
  for(const owner of ownedProfiles(rows)){
    try{
      const p=await readProfile(owner.id),status=p.status?.id==null?null:Number(p.status.id),tagged=p.tags?.includes(TAG)===true,running=Object.hasOwn(await readRunning(),String(owner.id));
      if(status===owner.previous&&!tagged&&!running){results.push({...owner,clean:true});continue;}
      if(status!==owner.lockStatus&&!(status===owner.previous&&tagged&&!running))throw Error('hh_recovery_ownership_changed');
      if(!apply){results.push({...owner,clean:false,running,tagged,action:'cleanup_required'});continue;}
      if(running)await stop(owner.id);
      if(tagged)await removeTag(owner.id,TAG);
      await restoreStatus(owner.id,owner.previous);
      const after=await readProfile(owner.id);
      if(after.tags?.includes(TAG)||(after.status?.id??null)!==owner.previous||Object.hasOwn(await readRunning(),String(owner.id)))throw Error('hh_recovery_cleanup_unconfirmed');
      results.push({...owner,clean:true,recovered:true});
    }catch(error){results.push({...owner,clean:false,error:/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_recovery_failed'});}
  }
  const starts=rows.filter(r=>r.kind==='client-lifecycle'&&r.event?.event==='Dolphin profile started');
  const missing=starts.filter(r=>!results.some(x=>x.id===Number(r.dolphinProfileId)));
  return {cleanupComplete:results.every(x=>x.clean)&&missing.length===0,profiles:results,unprovenProfileIds:missing.map(r=>r.dolphinProfileId)};
}
module.exports={ownedProfiles,recoverOwnedProfiles};

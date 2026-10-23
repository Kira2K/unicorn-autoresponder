function textPermission(entity,participant,now=Math.floor(Date.now()/1000)){
 if(entity.deactivated||entity.migratedTo)return {allowed:false,reason:'legacy_deactivated'};
 if(entity.restrictionReason?.length)return {allowed:false,reason:'platform_restriction'};
 if(!participant||participant.className?.endsWith('Left')||participant.left)return {allowed:null,reason:'membership_unconfirmed'};
 const admin=/Creator|Admin/.test(participant.className||'');
 if(entity.broadcast||entity.gigagroup){if(!admin||entity.broadcast&&!/Creator/.test(participant.className)&&!participant.adminRights?.postMessages)return {allowed:false,reason:'admin_only_chat'};}
 if(admin)return {allowed:true,reason:'admin'};
 for(const [reason,rights] of [['group_restriction',entity.defaultBannedRights],['personal_restriction',participant.bannedRights]]){
  if(rights?.untilDate&&rights.untilDate<now)continue;
  if(rights?.viewMessages||rights?.sendMessages||rights?.sendPlain)return {allowed:false,reason};
 }
 return {allowed:true,reason:'permissions_allow_text'};
}
module.exports={textPermission};

async function verifyOwnedInvite(state,{ownerId,getExported}){
 const r=await getExported(state.invitation),i=r.invite;
 if(!i||i.link!==state.invitation||i.revoked||String(i.adminId)!==String(ownerId)||i.title!=='restoration v2 '+state.clientId)throw Error('owned_invite_verification_failed');
 return{verified:true,via:'owner_exported_invite',chatId:state.chatId};
}
module.exports={verifyOwnedInvite};

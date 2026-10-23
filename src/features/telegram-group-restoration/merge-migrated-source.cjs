function mergeMigratedSource(primary,legacy,sourceChatId){
 const legacyId=id=>String(BigInt(String(sourceChatId).replace('-',''))*100000000000000000000n+BigInt(id));
 const result=[...primary,...legacy.map(m=>({...m,source_original_chat_id:String(sourceChatId),source_original_message_id:String(m.id),id:legacyId(m.id)}))];
 if(new Set(result.map(m=>String(m.id))).size!==result.length)throw Error('merged_source_id_collision');
 return result;
}
module.exports={mergeMigratedSource};

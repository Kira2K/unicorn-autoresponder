async function marketFlag(db,clientId,market) {
  const {TABLES}=require('../../../integrations/noco/core/schema.ts');
  if(!Number.isSafeInteger(clientId)||clientId<1||!['Ru','En'].includes(market))throw Error('hh_flag_target_invalid');
  const rows=await db.findRecords(TABLES.hhAutoresponses.id,'clients_id',[String(clientId)],{limit:10});
  if(rows.nextKey||rows.records.length!==1)throw Error('hh_flag_record_ambiguous');
  const record=rows.records[0],field=market==='Ru'?'Делаем_отклики_Ru':'Делаем_отклики_En';
  return {record,field,enabled:record.data[field]===true};
}
async function setMarketFlag(db,{clientId,clientName,market,enabled}) {
  if(typeof enabled!=='boolean')throw Error('hh_flag_value_invalid');
  const {TABLES}=require('../../../integrations/noco/core/schema.ts');
  return db.transaction(async tx=>{
    const client=await tx.getRecord(TABLES.clients.id,[String(clientId)]);
    if(client?.data.client_name!==clientName)throw Error('hh_flag_client_mismatch');
    const initial=await marketFlag(tx,clientId,market);await tx.lockRecord(TABLES.hhAutoresponses.id,initial.record.key);
    const current=await marketFlag(tx,clientId,market),other=market==='Ru'?'Делаем_отклики_En':'Делаем_отклики_Ru';
    const result=await tx.patchRecord(TABLES.hhAutoresponses.id,current.record.key,{[current.field]:enabled});
    if(result.data[current.field]!==enabled||result.data[other]!==current.record.data[other])throw Error('hh_flag_verification_failed');
    return {clientId,clientName,market,before:current.enabled,enabled,otherMarketEnabled:result.data[other]};
  });
}
module.exports={marketFlag,setMarketFlag};

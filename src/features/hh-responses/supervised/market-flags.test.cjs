const {test}=require('node:test'),assert=require('node:assert/strict');
const {marketFlag,setMarketFlag}=require('./market-flags.cjs');
function fixture(){const row={key:['48'],data:{clients_id:149,Делаем_отклики_Ru:true,Делаем_отклики_En:true}},writes=[];const db={transaction:async fn=>fn(db),findRecords:async()=>({records:[row],nextKey:null}),lockRecord:async()=>{},getRecord:async()=>({data:{client_name:'Fixture'}}),patchRecord:async(t,k,data)=>{writes.push(data);Object.assign(row.data,data);return row;}};return {db,row,writes};}
test('the standard stop changes only the requested market and validates canonical identity',async()=>{
 const f=fixture();const result=await setMarketFlag(f.db,{clientId:149,clientName:'Fixture',market:'Ru',enabled:false});
 assert.equal(result.enabled,false);assert.equal(f.row.data.Делаем_отклики_En,true);assert.deepEqual(f.writes,[{Делаем_отклики_Ru:false}]);
 await assert.rejects(setMarketFlag(f.db,{clientId:149,clientName:'Wrong',market:'En',enabled:false}),/client_mismatch/);
 assert.equal(f.writes.length,1);
});
test('queue admission reads the current flag and ambiguity does not silently pick a record',async()=>{
 const f=fixture();assert.equal((await marketFlag(f.db,149,'Ru')).enabled,true);f.row.data.Делаем_отклики_Ru=false;assert.equal((await marketFlag(f.db,149,'Ru')).enabled,false);
 f.db.findRecords=async()=>({records:[f.row,f.row],nextKey:null});await assert.rejects(marketFlag(f.db,149,'Ru'),/ambiguous/);
});

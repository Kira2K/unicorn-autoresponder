const {test}=require('node:test'),assert=require('node:assert/strict');
const {nextAction}=require('./supervise.cjs');
test('automatic resume permits explicit throttle and local locks, blocks uncertain external outcomes',()=>{
 assert.equal(nextAction([{clientId:'1',lastError:'FLOOD'},{clientId:'2',lastError:'EPERM'}]).action,'resume');
 assert.equal(nextAction([{clientId:'1',lastError:'FLOOD_WAIT_60'}]).action,'resume');
 assert.equal(nextAction([{clientId:'1',completedAt:'done',lastError:'old'}]).action,'resume');
 assert.deepEqual(nextAction([{clientId:'1',lastError:'creation_outcome_unresolved'}]),{action:'blocked',clients:[{clientId:'1',code:'creation_outcome_unresolved'}]});
 assert.equal(nextAction([{clientId:'1',lastError:'final_sql_mismatch'}]).action,'blocked');
});

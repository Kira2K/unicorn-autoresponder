const {test}=require('node:test'),assert=require('node:assert/strict');
const {withTransientReadRetry}=require('./read-retry.cjs');
test('a transient read recovers without repeating subsequent side effects',async()=>{
 let reads=0,sends=0;const value=await withTransientReadRetry(async()=>{if(++reads<3)throw Error('postgres_read_unavailable');return 42},{sleep:async()=>{}});sends++;
 assert.equal(value,42);assert.equal(reads,3);assert.equal(sends,1);
});
test('a persistent outage is bounded to three read attempts',async()=>{
 let reads=0;await assert.rejects(withTransientReadRetry(async()=>{reads++;throw Error('postgres_read_unavailable')},{sleep:async()=>{}}));assert.equal(reads,3);
});
test('credentials, schema and ambiguous configuration failures are not retried',async()=>{
 for(const code of ['postgres_read_failed','invalid_appdb_postgres_config','ambiguous_account']){let reads=0;await assert.rejects(withTransientReadRetry(async()=>{reads++;throw Error(code)}));assert.equal(reads,1);}
});

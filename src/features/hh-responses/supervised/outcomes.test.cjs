const {test}=require('node:test'),assert=require('node:assert/strict');
const {finalStatuses,auditMarket}=require('./campaign-audit.cjs');
test('preparation failures remain visible when no profile ever reached a final browser status',()=>{
 const a={clientName:'A',dolphinProfileId:12,startButtonClicked:false,error:'missing credentials'},b={clientName:'B',dolphinProfileId:13,startButtonClicked:false,error:'read unavailable'};
 const rows=[{kind:'client-skipped-before-run',status:a},{kind:'run-results',results:[a,b]}];
 assert.equal(finalStatuses(rows).length,2);assert.equal(auditMarket('Ru',rows,{blockedTargets:[]}).broken.length,2);assert.equal(auditMarket('Ru',rows,{}).cleanupComplete,true);
});
test('a run-results snapshot does not count confirmed outcomes twice or lose unrelated missing targets',()=>{
 const sent={clientName:'A',dolphinProfileId:12,responseCount:4},missing1={clientName:'B',dolphinProfileId:0},missing2={clientName:'C',dolphinProfileId:0};
 const rows=[{kind:'client-final-status',status:sent},{kind:'run-results',results:[sent,missing1,missing2]}];
 assert.equal(finalStatuses(rows).length,3);assert.equal(finalStatuses(rows).reduce((n,s)=>n+(s.responseCount||0),0),4);
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {configuration,weekdayAllowed,assertNodeVersion}=require('./config.cjs');
const {createBudget}=require('./budget.cjs');
const {isolatedEnvironment,resolveCodex}=require('./codex-process.cjs');
test('an outdated VDS is rejected before loading TypeScript service integrations',()=>{
 for(const version of ['18.20.0','22.9.0','24.11.0'])assert.throws(()=>assertNodeVersion(version),/node_version_unsupported/);
 assert.doesNotThrow(()=>assertNodeVersion('24.12.0'));
});
test('market configuration preserves explicit scope and rejects stale storage / bad quotas',()=>{
 assert.equal(configuration([],{}).responseLimit,100);assert.equal(configuration([],{}).concurrency,4);
 const c=configuration(['--markets=en,ru','--limit=80','--concurrency=4'],{});
 assert.deepEqual(c.markets,['Ru','En']);assert.equal(c.responseLimit,80);
 for(const args of [['--limit=0'],['--markets=ru,ru'],['--markets=xx'],['--typo=yes']])assert.throws(()=>configuration(args,{}));
 assert.throws(()=>configuration([],{APP_DB:'noco'}));
 assert.equal(configuration([],{HH_REPORTS_CHAT_ID:'',HH_TECHNICAL_CHAT_ID:'',summary_logs_channel_id:'-100123'}).technicalChat,'-100123');
 assert.throws(()=>configuration([],{HH_RECOGNITION_TOKEN_BUDGET:'100'}),/reservation/);
 assert.equal(weekdayAllowed(c,new Date('2026-11-13T12:00:00Z')),false);
 assert.equal(weekdayAllowed(c,new Date('2026-11-16T12:00:00Z')),true);
 assert.equal(weekdayAllowed({...c,allowWeekend:true},new Date('2026-11-13T12:00:00Z')),true);
});
test('concurrent recognition reserves admission budget and unknown usage closes it',()=>{
 const b=createBudget({maxCalls:3,tokenBudget:20000,reserveTokens:10000});
 const a=b.reserve(),c=b.reserve();assert.throws(()=>b.reserve(),/budget_closed/);
 b.settle(a,{input_tokens:7000,output_tokens:100,cached_input_tokens:4000});
 b.settle(c,null);assert.throws(()=>b.reserve());
 assert.deepEqual(b.snapshot(),{calls:2,maxCalls:3,knownInputTokens:7000,knownOutputTokens:100,cachedInputTokens:4000,knownTotalTokens:7100,unknownUsageCalls:1,reservedTokens:10000,tokenBudget:20000,closed:true,pending:0});
 assert.throws(()=>b.settle(a,null),/ticket_invalid/);
});
test('recognizer environment excludes all student/service credentials and missing executable fails early',()=>{
 assert.deepEqual(isolatedEnvironment({PATH:'bin',USERPROFILE:'profile',CODEX_HOME:'auth-location',APP_DB_POSTGRES_PASSWORD:'secret',VEU_SUPPORT_BOT:'token',OPENAI_API_KEY:'key'}),{PATH:'bin',USERPROFILE:'profile',CODEX_HOME:'auth-location'});
 assert.throws(()=>resolveCodex('missing-relative.exe'),/cli_missing/);
});

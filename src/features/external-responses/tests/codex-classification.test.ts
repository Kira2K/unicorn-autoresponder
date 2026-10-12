import test from 'node:test'
import assert from 'node:assert/strict'
import { classificationThread,createCodexClassificationTransport,probeClassificationClient } from '../stack_classification/codex-classification.ts'
import { runClassificationBatches,type AssessmentRecord } from '../stack_classification/classification-runner.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { AssessmentBatch } from '../stack_classification/assessment-batches.ts'
import { classificationUsage } from '../reporting/classification-metrics.ts'

const batch={id:'batch-1',bytes:10,expanded:false,payload:{instructions:'Classify only supplied data',selectionRules:'No junior',stacks:[],vacancies:[]},outputSchema:{type:'object',properties:{},additionalProperties:false}} as AssessmentBatch
const settings={model:'gpt-6-sol' as const,effort:'medium' as const,maxOutputTokens:1000}
const proof=async()=>({toolsAbsent:true,structuredOutput:true,model:'gpt-6-sol',inputBytes:50,providerOutputCap:false})
function fake(options:{account?:string;models?:any[];events?:any[];start?:(emit:(method:string,params:any)=>void)=>void;hang?:boolean}={}){
  const calls:any[]=[],emitters:((method:string,params:any)=>void)[]=[]
  const factory=(hooks:any)=>{
    const emit=(method:string,params:any)=>hooks?.onNotification?.({method,params});emitters.push(emit)
    return {readModels:async()=>options.models??[{model:'gpt-6-sol',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}],readAccount:async()=>({account:{type:options.account??'chatgpt'}}),readPrimaryRateLimit:async()=>({}),
      startOwnedThread:async(owner:string,params:any)=>{calls.push(['thread',params]);return {result:{},ownedThread:{ownerToken:owner,threadId:'thread-1'}}},
      startOwnedTurn:async(owner:string,params:any)=>{calls.push(['turn',params]);options.start?.(emit)
        for(const e of options.events??[])emit(e.method,e.params)
        if(!options.hang){emit('item/completed',{item:{type:'agentMessage',text:JSON.stringify({batchId:batch.id,decisions:[]})}});emit('turn/completed',{turn:{id:'turn-1',status:'completed'}})}
        return {result:{},ownedTurn:{ownerToken:owner,threadId:'thread-1',turnId:'turn-1'}}},
      interruptOwnedTurn:async(ref:any)=>{calls.push(['interrupt',ref])},close:async()=>{calls.push(['close'])}}
  }
  return {factory,calls,emitters}
}

test('fresh classification profile disables agent capabilities without mutating engine/global config',()=>{
  const p=classificationThread('fixture')
  assert.equal(p.model,'gpt-6-sol');assert.equal(p.modelProvider,'openai');assert.equal(p.allowProviderModelFallback,false)
  assert.equal(p.sandbox,'read-only');assert.equal(p.ephemeral,true);assert.deepEqual(p.dynamicTools,[])
  assert.equal(p.config.features.shell_tool,false);assert.equal(p.config.features.apps,false);assert.equal(p.config.features.plugins,false)
  assert.equal(p.config.features.multi_agent,false);assert.equal(p.config.features.browser_use,false)
  assert.equal(p.config.project_doc_max_bytes,0)
})

test('preflight refuses extra tools, wrong model or absent schema; generate cannot bypass it',async()=>{
  for(const change of [{toolsAbsent:false},{model:'different'},{structuredOutput:false}]){
    const f=fake(),transport=createCodexClassificationTransport({createServer:f.factory,probe:async()=>({...await proof(),...change})})
    assert.equal((await transport.preflight()).toolExecution,'unverified')
    await assert.rejects(transport.generate(batch,settings),/preflight_required/);assert.equal(f.calls.length,0)
  }
  const f=fake(),t=createCodexClassificationTransport({createServer:f.factory,probe:async()=>{throw Error('classification_probe_timeout')}})
  assert.equal((await t.preflight()).reason,'codex_classification_wire_preflight_failed:classification_probe_timeout')
  await assert.rejects(t.generate(batch,settings),/preflight_required/);assert.equal(f.calls.length,0)
})

test('unlisted model blocks classification before a durable generation intent or thread starts',async()=>{
  const f=fake({models:[{model:'gpt-5.6-sol',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]})
  const transport=createCodexClassificationTransport({createServer:f.factory,probe:proof})
  let claims=0
  await assert.rejects(runClassificationBatches([batch],{transport,store:{load:async()=>undefined,claim:async()=>{claims++;return true},save:async()=>{}},admit:async()=>{},settings}),/sol_model_not_listed:gpt-6-sol/)
  assert.equal(claims,0);assert.equal(f.calls.some(c=>c[0]==='thread'||c[0]==='turn'),false)
})

test('sends exact batch/schema with medium Sol; captures early final events and final cumulative usage once',async()=>{
  const f=fake({events:[{method:'thread/tokenUsage/updated',params:{tokenUsage:{total:{inputTokens:100,outputTokens:20,reasoningOutputTokens:10,cachedInputTokens:5}}}},
    {method:'thread/tokenUsage/updated',params:{tokenUsage:{total:{inputTokens:100,outputTokens:20,reasoningOutputTokens:10,cachedInputTokens:5}}}}]})
  const t=createCodexClassificationTransport({createServer:f.factory,probe:proof});await t.preflight()
  const result=await t.generate(batch,settings),turn=f.calls.find(x=>x[0]==='turn')[1]
  assert.deepEqual(turn.outputSchema,batch.outputSchema);assert.equal(turn.model,settings.model);assert.equal(turn.effort,'medium')
  assert.deepEqual(JSON.parse(turn.input[0].text),{batchId:batch.id,...batch.payload})
  assert.equal(result.toolCalls,0);assert.equal(result.usage!.inputTokens,100);assert.equal(result.responseId,'thread-1:turn-1')
  assert.equal(f.calls.filter(x=>x[0]==='turn').length,1);assert.equal(f.calls.at(-1)[0],'close')
})

test('API-key accounts cannot generate paid requests through the Codex-only adapter',async()=>{
  const f=fake({account:'apiKey'}),t=createCodexClassificationTransport({createServer:f.factory,probe:proof});await t.preflight()
  await assert.rejects(t.generate(batch,settings),/no_paid_api_fallback/)
  assert.equal(f.calls.some(x=>x[0]==='turn'),false)
})

test('tool attempts and observed output overruns fail, cancel the owned turn and retain measured failed usage',async()=>{
  for(const extra of [{method:'item/started',params:{item:{type:'commandExecution',id:'bad'}}},{method:'thread/tokenUsage/updated',params:{tokenUsage:{total:{inputTokens:100,outputTokens:1001}}}}]){
    const f=fake({hang:true,events:[{method:'thread/tokenUsage/updated',params:{tokenUsage:{total:{inputTokens:100,outputTokens:100}}}},extra]}),t=createCodexClassificationTransport({createServer:f.factory,probe:proof});await t.preflight()
    await assert.rejects(t.generate(batch,settings),(e:any)=>{assert.equal(e.classificationResponse.usage.inputTokens,100);return /unexpected_tool|observed_output/.test(e.message)})
    assert.equal(f.calls.filter(x=>x[0]==='interrupt').length,1)
  }
})

test('abort racing turn/start cancels only owned work, closes resources and never retries',async()=>{
  const controller=new AbortController(),f=fake({hang:true,start:()=>controller.abort()}),t=createCodexClassificationTransport({createServer:f.factory,probe:proof});await t.preflight()
  await assert.rejects(t.generate(batch,{...settings,signal:controller.signal}),/cancelled/)
  assert.equal(f.calls.filter(x=>x[0]==='turn').length,1);assert.equal(f.calls.filter(x=>x[0]==='interrupt').length,1)
  assert.equal(f.calls.at(-1)[0],'close')
})

test('missing completion times out without resubmission',async()=>{
  const f=fake({hang:true}),t=createCodexClassificationTransport({createServer:f.factory,probe:proof,timeoutMs:10});await t.preflight()
  await assert.rejects(t.generate(batch,settings),/timeout/)
  assert.equal(f.calls.filter(x=>x[0]==='interrupt').length,1)
})

test('failed provider completion retains the actual sanitized reason without an automatic retry',async()=>{
  const f=fake({hang:true,events:[{method:'turn/completed',params:{turn:{id:'turn-1',status:'failed',error:{message:'Invalid response schema: fixture failure'}}}}]}),t=createCodexClassificationTransport({createServer:f.factory,probe:proof});await t.preflight()
  await assert.rejects(t.generate(batch,settings),(e:any)=>{assert.equal(e.classificationResponse.failure.message,'Invalid response schema: fixture failure');assert.equal(e.classificationResponse.failure.status,'failed');return true})
  assert.equal(f.calls.filter(x=>x[0]==='turn').length,1)
})

test('failed generation stores usage durably and resume does not spend again',async()=>{
  const f=fake({hang:true,events:[{method:'thread/tokenUsage/updated',params:{tokenUsage:{total:{inputTokens:123,outputTokens:1001}}}}]}),t=createCodexClassificationTransport({createServer:f.factory,probe:proof})
  const records=new Map<string,AssessmentRecord>(),store={load:async(id:string)=>records.get(id),claim:async(id:string,r:AssessmentRecord)=>{records.set(id,r);return true},save:async(id:string,r:AssessmentRecord)=>{records.set(id,r)}}
  const value={...batch,id:digest(batch)}
  const first=await runClassificationBatches([value],{store,transport:t,settings,admit:async()=>{}})
  assert.equal(records.get(value.id)!.response!.usage!.inputTokens,123)
  assert.equal(classificationUsage(first.responses).inputTokens,123)
  const resumed=await runClassificationBatches([value],{store,transport:t,settings,admit:async()=>{throw Error('no admission on resume')}})
  assert.equal(classificationUsage(resumed.responses).inputTokens,123)
  assert.equal(f.calls.filter(x=>x[0]==='turn').length,1)
})

test('local wire preflight uses native provider on loopback and never supplies vacancy data',async()=>{
  let params:any
  const f=fake(),factory=(hooks:any)=>({...f.factory(hooks),
    startOwnedThread:async(owner:string,p:any)=>{params=p;return {result:{},ownedThread:{ownerToken:owner,threadId:'probe'}}},
    startOwnedTurn:async(owner:string,p:any)=>{
      assert.equal(params.modelProvider,'openai');assert.match(params.config.openai_base_url,/^http:\/\/127\.0\.0\.1:\d+$/)
      assert.equal(params.config.chatgpt_base_url,params.config.openai_base_url)
      assert.match(p.input[0].text,/Local capability probe/)
      await fetch(params.config.openai_base_url+'/responses',{method:'POST',body:JSON.stringify({model:p.model,input:p.input,text:{format:{type:'json_schema'}}})})
      return {result:{},ownedTurn:{ownerToken:owner,threadId:'probe',turnId:'probe-turn'}}
    }})
  const result=await probeClassificationClient({createServer:factory})
  assert.equal(result.toolsAbsent,true);assert.equal(result.structuredOutput,true);assert.equal(result.providerOutputCap,false)
})

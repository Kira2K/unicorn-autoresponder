import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceSpan } from '../stack_classification/evidence-span.ts'
import { buildAssessmentBatches, validateBatchResponse } from '../stack_classification/assessment-batches.ts'
import { runClassificationBatches } from '../stack_classification/classification-runner.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { validateSourceDescriptions } from '../vacancy_collection/source-quality.ts'
test('action labels cannot masquerade as excluded job titles and complete source coverage',()=>{
 const audit:any={source:{name:'Fixture',url:'https://example.test'},status:'complete',issues:[],titlePrecheck:{skipped:[{title:'Apply now'}]}}
 const result=validateSourceDescriptions([audit],[])[0]
 assert.equal(result.status,'partial');assert.match(result.issues[0],/action label/)
 assert.equal(audit.status,'complete')
 assert.equal(validateSourceDescriptions([{...audit,titlePrecheck:{skipped:[{title:'Sales Manager'}]}}],[])[0].status,'complete')
})
test('whitespace resolves to original span without changing words, numbers, punctuation or fields',()=>{
 const source='Go\u00a0or\n  Python; salary 3000.'
 assert.equal(evidenceSpan('Go or Python',[source]),'Go\u00a0or\n  Python')
 for(const space of ['&nbsp;','&#160;','&#xa0;','&#x00A0;'])assert.equal(evidenceSpan('Go or Python',['Go '+space+'or Python']), 'Go '+space+'or Python')
 assert.equal(evidenceSpan('Go and Python',['Go &#38; Python']),undefined)
 for(const quote of ['Go and Python','salary 3001.','python','Go or Python,','GoPython','   '])assert.equal(evidenceSpan(quote,[source]),undefined)
 assert.equal(evidenceSpan('Go Python',['Go','Python']),undefined)
 assert.equal(evidenceSpan('work worldwide',['cannot work worldwide']), 'work worldwide') // Literal substrings are unchanged, not semantic verification.
 assert.equal(evidenceSpan('work worldwide',['work not worldwide']),undefined)
})
test('pending evidence response revalidates without dispatch; raw response and old failure survive',async()=>{
 const packet:any={collectionRunId:'run',positionId:'p',inputHash:'h',requirements:{selectionRules:'rules',stacks:[{id:'7',description:'Go'}]},vacancy:{title:'Go Developer',description:'Go\u00a0or\n Python',location:''}}
 const b=buildAssessmentBatches([packet]).batches[0]
 const d={decision:'eligible',reasons:['Go'],evidence:['Go or Python']}
 const value={batchId:b.id,decisions:[{positionId:'p',inputHash:'h',global:d,stacks:{'7':d}}]}
 let record:any={binding:digest({batch:b,policy:'policy'}),status:'pending',reason:'assessment_evidence_invalid',startedAt:'2026-09-30T00:00:00Z',response:{value,toolCalls:0}}
 const deps:any={policyHash:'policy',store:{load:async()=>record,claim:async()=>{throw Error('claim')},save:async(_id:string,v:any)=>{record=v}},admit:async()=>{throw Error('admit')},transport:{preflight:async()=>{throw Error('preflight')},generate:async()=>{throw Error('generate')}}}
 const result=await runClassificationBatches([b],deps)
 assert.equal(result.reused,1);assert.equal(record.revalidation.previousReason,'assessment_evidence_invalid')
 assert.equal(result.completed[0].decisions.p.global.evidence[0],packet.vacancy.description)
 assert.equal(record.response.value.decisions[0].global.evidence[0],'Go or Python')
 assert.equal((await runClassificationBatches([b],deps)).reused,1)
 record={...record,status:'pending',reason:'provider_failed'}
 assert.equal((await runClassificationBatches([b],deps)).completed.length,0)
 record={...record,reason:'assessment_evidence_invalid',response:{value:{...value,decisions:[{...value.decisions[0],inputHash:'changed'}]},toolCalls:0}}
 assert.equal((await runClassificationBatches([b],deps)).completed.length,0)
 assert.throws(()=>validateBatchResponse(b,{...value,decisions:[{...value.decisions[0],global:{...d,evidence:['invented']}}]}),/evidence/)
})

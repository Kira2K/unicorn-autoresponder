import { SOL_MODEL } from '../infrastructure/sol-model.ts'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { atomicJson, createFileStore } from '../infrastructure/store.ts'
import { createBrowserSession, parseBrowserDriver } from '../infrastructure/browser.ts'
import { createPageReader } from './page-reader.ts'
import { validateRepairPlan, assertInvestigation } from './session-reasoner.ts'
import type { Investigation } from './session-reasoner.ts'
import type { PageDocument, PageReader, PageReadOptions } from '../types.ts'
import type { SourceAction } from './source-memory.ts'

export type InspectionLedger={requestId:string;sourceId:string;reads:{startedAt:string;activeMs:number;status:'started'|'complete'|'failed';page?:PageDocument;actions:SourceAction[];error?:string}[]}
export async function loadInspections(path:string,request:Investigation):Promise<InspectionLedger> {
  try {
    const ledger:InspectionLedger=JSON.parse(await readFile(path,'utf8'))
    if(ledger.requestId!==request.id||ledger.sourceId!==request.source.database!.sourceId||!Array.isArray(ledger.reads))throw Error('inspection_binding_invalid')
    return ledger
  }catch(error:any){if(error.code==='ENOENT')return {requestId:request.id,sourceId:request.source.database!.sourceId,reads:[]};throw error}
}
/** Host-owned diagnostic read. Budget intent survives a crash; it cannot save or apply a vacancy. */
export async function inspectSource(input:{request:Investigation;path:string;url:string;options?:PageReadOptions},reader:PageReader) {
  const {request}=input,ledger=await loadInspections(input.path,request)
  const remainingMs=request.remainingMs-ledger.reads.reduce((n,r)=>n+r.activeMs,0)
  if(ledger.reads.length>=request.remainingReads||remainingMs<=0)throw Error('source_investigation_budget_exhausted')
  validateRepairPlan({entryUrls:[input.url]}, {...request,observations:[...request.observations,...ledger.reads.flatMap(r=>r.page?[r.page]:[])]},{version:1,requestId:request.id,sourceId:request.source.database!.sourceId,model:SOL_MODEL,origin:'assistant_session',action:'repair',reason:'Host diagnostic inspection'})
  const at=Date.now(),record:InspectionLedger['reads'][number]={startedAt:new Date(at).toISOString(),activeMs:remainingMs,status:'started',actions:[]}
  ledger.reads.push(record);await atomicJson(input.path,ledger)
  try {
    record.page=await reader.read(input.url,{...input.options,onAction:async action=>{record.actions.push(action);await atomicJson(input.path,ledger)}})
    record.status='complete'
  }catch(error){record.status='failed';record.error=error instanceof Error?error.message:String(error)}
  record.activeMs=Date.now()-at;await atomicJson(input.path,ledger)
  return ledger
}

export async function sourceInspectionCommand(args:string[]) {
  const arg=(name:string)=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1]}
  if(!arg('request')||!arg('url'))throw Error('inspection_request_and_url_required')
  const path=resolve(arg('request')!),request:Investigation=JSON.parse(await readFile(path,'utf8'))
  assertInvestigation(request)
  const id=request.id
  const release=await createFileStore(resolve('storage/external-responses')).lock('shared-vacancy-collection')
  let browser:Awaited<ReturnType<typeof createBrowserSession>>|undefined
  try {
    browser=await createBrowserSession({profilePath:resolve('storage/external-responses/candidates/collection/browser'),driver:parseBrowserDriver(arg('browser-driver'))})
    const reader=createPageReader({context:browser,evidenceDirectory:join(dirname(path),'evidence'),excludedHosts:['himalayas.app','hiringcafe.com','wantapply.com','hirefy.com','hirify.me']})
    const ledger=await inspectSource({request,path:join(dirname(path),id+'.inspections.json'),url:arg('url')!,options:{...(arg('steps')?{steps:JSON.parse(await readFile(arg('steps')!,'utf8'))}:{}),...(arg('extraction')?{extraction:JSON.parse(await readFile(arg('extraction')!,'utf8'))}:{})}},reader)
    const last=ledger.reads.at(-1)!
    console.log(JSON.stringify({evidence:join(dirname(path),id+'.inspections.json'),status:last.status,error:last.error,url:last.page?.url,remainingReads:request.remainingReads-ledger.reads.length,remainingMs:request.remainingMs-ledger.reads.reduce((n,r)=>n+r.activeMs,0)}))
  } finally {try {await browser?.close()}finally{await release()}}
}

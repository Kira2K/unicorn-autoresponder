import {createRequire} from 'node:module';
import {createPostgresRecordSource} from '../../../platform/db/postgres/record-source.mts';
import {loadRuntimePostgresReader} from '../../../platform/db/postgres/runtime.mts';
import type {AppDbRow} from '../../../platform/db/postgres/record-source.mts';
import type {AppDb} from '../../../platform/db/types.ts';
import type {OctoHhTarget} from './run.mts';
import {allowedHhScenario} from './run.mts';
const require=createRequire(import.meta.url);
const {TABLES}=require('../../../integrations/noco/core/schema.ts') as {TABLES:Record<string,{id:string}>};
const {createNocoDb,resolveStack,stackScenario,getBlockedCompaniesForClientMarket,isEnabled,responseField}=
  require('../../../platform/db/noco/noco-db.ts') as {
    createNocoDb(options:{nocoClient:OctoHhTargetDependencies['source']}):AppDb;
    resolveStack(row:AppDbRow,client:AppDbRow,name:string,stacks:AppDbRow[]):{id:number|null;name:string;source:string;row?:AppDbRow};
    stackScenario(stack:unknown,market:'Ru'|'En'):string|undefined;
    getBlockedCompaniesForClientMarket(client:AppDbRow,market:'Ru'|'En',restrictions:AppDbRow[]):Array<{id:string;name:string}>;
    isEnabled(value:unknown):boolean;responseField(market:'Ru'|'En'):string;
  };
export interface OctoHhTargetInput {clientId:number;market:'Ru'|'En';allowDisabled?:boolean;coverTextOverride?:string}
export interface OctoHhTargetDependencies {
  source:{fetchRecords(tableId:string):Promise<AppDbRow[]>};
  credentials(clientName:string,market:'Ru'|'En'):Promise<{login:string;password:string;market?:'Ru'|'En'}>;
}
export interface OctoHhReadiness {
  clientId:number;market:'Ru'|'En';clientName?:string;ready:boolean;reason:string;enabled:boolean;manualOptIn:boolean;
  stack?:string;hasScenario:boolean;hasCover:boolean;coverSource?:'database'|'run_override';hasCredentials:boolean;blockedCompanyCount:number;
}
export interface OctoHhLoadedTarget {target?:OctoHhTarget;readiness:OctoHhReadiness}
function runtimeDependencies():OctoHhTargetDependencies{
  const source=createPostgresRecordSource(loadRuntimePostgresReader);
  // Reuse the existing AppDb credential rules on the same read-only PostgreSQL source.
  // This never calls automation target selection or asks for a Dolphin profile ID.
  const db=createNocoDb({nocoClient:source});
  return {source,credentials:(name,market)=>db.getHHAuthCredentialsByClientName(name,market)};
}
const normalized=(value:unknown)=>String(value??'').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
const links=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value:
  value&&typeof value==='object'?[value as Record<string,unknown>]:[];
function owner(row:AppDbRow){return Number(row.clients_id??links(row.rel_hhAutoresponses_client)[0]?.Id);}
export async function loadOctoHhTarget(input:OctoHhTargetInput,deps?:OctoHhTargetDependencies):Promise<OctoHhLoadedTarget>{
  const readiness:OctoHhReadiness={clientId:input.clientId,market:input.market,ready:false,reason:'target_unavailable',
    enabled:false,manualOptIn:input.allowDisabled===true,hasScenario:false,hasCover:false,hasCredentials:false,blockedCompanyCount:0};
  const fail=(reason:string):OctoHhLoadedTarget=>{readiness.reason=reason;return {readiness};};
  if(!Number.isSafeInteger(input.clientId)||input.clientId<1||!['Ru','En'].includes(input.market))return fail('invalid_target_input');
  deps??=runtimeDependencies();
  try{
    const clients=await deps.source.fetchRecords(TABLES.clients.id),matches=clients.filter(row=>Number(row.Id)===input.clientId);
    if(matches.length!==1)return fail(matches.length?'client_ambiguous':'client_missing');
    const client=matches[0],name=String(client.client_name??'').trim();
    if(!name)return fail('client_name_missing');
    readiness.clientName=name;
    if(clients.filter(row=>normalized(row.client_name)===normalized(name)).length!==1)return fail('client_name_ambiguous');
    const values=await Promise.allSettled([deps.source.fetchRecords(TABLES.hhAutoresponses.id),
      deps.source.fetchRecords(TABLES.stacks.id),deps.source.fetchRecords(TABLES.restrictions.id)]);
    if(values.some(value=>value.status==='rejected'))return fail('target_source_unavailable');
    const [rows,stacks,restrictions]=values.map(value=>(value as PromiseFulfilledResult<AppDbRow[]>).value);
    const bound=rows.filter(row=>owner(row)===input.clientId);
    if(bound.length!==1)return fail(bound.length?'autoresponse_ambiguous':'autoresponse_missing');
    const row=bound[0];readiness.enabled=isEnabled(row[responseField(input.market)]);
    if(!readiness.enabled&&!readiness.manualOptIn)return fail('autoresponse_disabled');
    const override=links(row['Stack Override']),primary=links(client.rel_clients_primary_stack);
    if(override.length>1||(!override.length&&primary.length>1))return fail('stack_ambiguous');
    let stack:ReturnType<typeof resolveStack>;
    try{stack=resolveStack(row,client,name,stacks);}catch{return fail('stack_ambiguous');}
    if(!stack.name||!stack.row||!stack.id)return fail('stack_missing');
    if(stacks.filter(s=>Number(s.Id)===stack.id).length!==1)return fail('stack_ambiguous');
    const selectedLinks=stack.source==='override'?override:primary;
    if(selectedLinks.length>1)return fail('stack_ambiguous');
    const selected=selectedLinks[0];
    if(selected&&!Number(selected.Id)){
      const key=normalized(selected.name??selected.stack);
      if(stacks.filter(s=>[s.name,s.slug,s.hh_scenario_alias].some(value=>normalized(value)===key)).length!==1)return fail('stack_ambiguous');
    }
    readiness.stack=stack.name;
    const scenario=stackScenario(stack,input.market);
    if(!scenario)return fail('scenario_missing');
    if(!allowedHhScenario(scenario))return fail('scenario_invalid');
    readiness.hasScenario=true;
    const overridden=input.coverTextOverride!==undefined;
    const cover=overridden?input.coverTextOverride!:String(row[input.market==='Ru'?'Сопровод_Ru':'Сопровод_En']??'').trim();
    if(typeof cover!=='string'||!cover.trim())return fail('cover_missing');
    readiness.coverSource=overridden?'run_override':'database';
    readiness.hasCover=true;
    const blocked=getBlockedCompaniesForClientMarket(client,input.market,restrictions);
    readiness.blockedCompanyCount=blocked.length;
    let credentials:Awaited<ReturnType<OctoHhTargetDependencies['credentials']>>;
    try{credentials=await deps.credentials(name,input.market);}catch{return fail('credentials_unavailable');}
    if(typeof credentials.login!=='string'||!credentials.login.trim()||typeof credentials.password!=='string'||!credentials.password
      ||(credentials.market!==undefined&&credentials.market!==input.market))return fail('credentials_missing');
    readiness.hasCredentials=true;readiness.ready=true;readiness.reason=readiness.enabled?'ready':'ready_manual_opt_in';
    return {readiness,target:{clientName:name,market:input.market,stackScenario:scenario,coverText:cover,
      blockedCompanies:blocked,hhAuthCredentials:{login:credentials.login,password:credentials.password}}};
  }catch{return fail('target_source_unavailable');}
}

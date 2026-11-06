import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createMemoryStore,createMockCloud,testConfig} from '../../octo-access/testing.mts';
import {createOctoRuntime} from '../../octo-access/runtime.mts';
import {createProxyMoveService} from '../proxy-move/service.mts';
import {createLinkedInIntakeService} from '../console-intake/service.mts';
import type {Move,MoveStore} from '../proxy-move/contracts.mts';
import type {SavedProxy} from '../../octo-access/contracts.mts';
import type {LinkedInIntakeView} from '../console-intake/contracts.mts';
import type {CreationTaskService} from '../creation-tasks/service.mts';
import type {CreationTask} from '../creation-tasks/contracts.mts';
const require=createRequire(import.meta.url);
const {createMockNocoClient}=require('../../web-console/backend/mock-data.ts');
const {createWebConsoleRepository}=require('../../web-console/backend/repository.ts');
const {createWebConsoleApp}=require('../../web-console/backend/app.ts');
export async function createLinkedInMockFixture() {
  const noco=createMockNocoClient(),rows=await noco.fetchRecords('mxza381054ldlza');
  for(const id of [901,902])rows.push({Id:id,first_name:'Тест',last_name:id===901?'Переезд':'Заявка',client_name:`Тест ${id}`,
    calendar_email:`linkedin-local-${id}@example.invalid`,market:'En',telegram_general_chat_id:'-5216637594',
    rel_clients_primary_stack:{Id:14,name:'JAVA'},ready_for_interview_in_english_in_2_months:'Yes',real_location:'Tbilisi'});
  let clockOffset=0;const now=()=>Date.now()+clockOffset;
  const repository=createWebConsoleRepository({nocoClient:noco}),profiles=createMemoryStore(),cloud=createMockCloud(profiles,now);
  const proxies=new Map<string,SavedProxy>(),moves=new Map<number,Move>(),accounts=new Map<number,LinkedInIntakeView>(),tasks=new Map<number,CreationTask>();
  const notices:Array<{eventId:string;chatId:string}>=[];
  const api={...cloud.api,
    async listProxies(){return [...proxies.values()];},async proxyConnections(marker:string){return [...proxies.values()].filter(p=>p.externalId===marker);},
    async createProxy(input:any){const p={...input,uuid:randomUUID().replaceAll('-',''),profiles_count:0};proxies.set(p.uuid,p);return p;},
    async attachProxy(uuid:string,proxyUuid:string){const p=cloud.profiles.get(uuid)!;if(p.proxy?.uuid&&proxies.has(p.proxy.uuid))proxies.get(p.proxy.uuid)!.profiles_count=0;p.proxy={uuid:proxyUuid};proxies.get(proxyUuid)!.profiles_count=1;},
    async updateProxy(uuid:string,title:string){proxies.get(uuid)!.title=title;},
    async readProfileProxy(uuid:string){return{saved:structuredClone(proxies.get(cloud.profiles.get(uuid)?.proxy?.uuid||''))};}
  };
  const getClient=async(id:number)=>({...await repository.getClientById(id),readyForInterviewInEnglishIn2Months:'Yes' as const});
  const runtime=createOctoRuntime({store:profiles,api,config:{...testConfig,leaseMs:120000},token:'mock-only',getClient,now,
    listen:()=>({start(){},async stop(){},status(){return{connected:true,reconnects:0,checkpoint:0,lastSafeError:undefined};}})});
  const empty=():LinkedInIntakeView=>({url:'',login:'',hasPassword:false,outlookLogin:'',hasOutlookPassword:false,firstName:'',lastName:'',realLocation:'Tbilisi',blockedAccounts:[]});
  accounts.set(901,{...empty(),linkedinAccountId:901,hasLinkedIn:true,url:'https://www.linkedin.com/in/synthetic-local-test',login:'synthetic@example.invalid',hasPassword:true});
  const seed=async(id:number)=>{
    const password=id===901?'12345':'12346';
    const meta={title:`Тест ${id} JAVA En`,description:`linkedin-local-mock:${id}`,tags:[],start_pages:[]};
    const uuid=await api.createProfile({...meta,folder:'home',password});await api.clearPassword(uuid,password);
    const old=await api.createProxy({type:'socks5',host:'old.example.invalid',port:1080,login:'mock',password:'mock-only',title:'Expert mock',externalId:`old-${id}`});
    await api.attachProxy(uuid,old.uuid);
    await profiles.reserve([{clientId:id,locale:'en',phase:'ready',createdAt:Date.now(),operationId:randomUUID(),password,uuid,ownProxy:true,original:meta,
      proxy:{uuid:old.uuid,title:old.title,type:old.type,host:old.host,port:old.port,isMadeByExpert:true}}]);
  };
  await seed(901);
  const intake=createLinkedInIntakeService({allowed:id=>[901,902].includes(id),getClient,hasDolphin:async()=>false,store:{
    async load(id){const task=tasks.get(id);return{...structuredClone(accounts.get(id)||empty()),...(task?{task,registrationPending:task.status!=='сделана экспертом',completionConfirmed:task.status==='сделана экспертом',editLocked:task.status==='сделана экспертом'}:{})};},
    async save(id,data){const old=accounts.get(id);let task=tasks.get(id);const created=!task;
      if(!task){task={id,clientId:id,linkedinAccountId:id,outlookAccountId:id+100,status:'не начата',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};tasks.set(id,task);await seed(id);}
      accounts.set(id,{...empty(),...data,hasPassword:!!old?.hasPassword,hasOutlookPassword:true,linkedinAccountId:id,outlookAccountId:id+100,
        outlookForwardingConfirmedAt:old?.outlookLogin===data.outlookLogin&&old?.outlookForwardingConfirmedAt||new Date().toISOString()});
      return{saved:true as const,linkedinAccountId:id,outlookAccountId:id+100,task:{...task,created}};}
  }});
  const moveStore:MoveStore={async checkSchema(){},async read(id){return structuredClone(moves.get(id));},
    async begin(m,p,input){moves.set(m.clientId,structuredClone(m));await profiles.save({...p,proxyChange:{id:m.id,phase:'queued',input,title:`${p.original.title} | ${p.uuid}`,isMadeByExpert:false}});},
    async finish(m,p,at){const done={...m,phase:'completed' as const,completedAt:at,pauseUntil:new Date(Date.parse(at)+48*3600000).toISOString()};moves.set(m.clientId,done);notices.push({eventId:m.id,chatId:'-5216637594'});return done;}};
  const moveService=createProxyMoveService({store:moveStore,profiles,account:id=>intake.load(id),allowed:id=>[901,902].includes(id),hasDolphin:async()=>false,client:getClient,
    check:async input=>({ok:true,exit_ip:'1.1.1.1',country:input.host==='wrong.example.invalid'?'Georgia':'Spain'}),previousProxy:api.readProfileProxy});
  const creator={async list(){return [...tasks.values()].filter(t=>t.status!=='сделана экспертом').map(t=>({...t,fio:'Тест Заявка',stack:'JAVA'}));},
    async detail(id:number){id=Number(id);return{task:structuredClone(tasks.get(id)!),intake:await intake.load(id),client:{id,fio:'Тест Заявка',stack:'JAVA'}};},
    async profileStatus(id:number,credentials:boolean){id=Number(id);return runtime.service.status(id,{staff:true,proxyCredentials:credentials});},
    async saveProxy(id:number,pid:number,input:unknown){id=Number(id);pid=Number(pid);await runtime.service.saveProxy(id,pid,input,true);const t=tasks.get(id)!;delete t.proxySavedAt;return{queued:true,task:structuredClone(t)};},
    async acquire(id:number,pid:number){id=Number(id);pid=Number(pid);return runtime.service.acquire(id,pid);},async grant(id:number,gid:string){id=Number(id);return runtime.service.grant(id,gid);},
    async capture(id:number){id=Number(id);const t=tasks.get(id)!;t.proxySavedAt=new Date().toISOString();t.version++;return structuredClone(t);},
    async result(id:number,body:any){id=Number(id);const a=accounts.get(id)!;Object.assign(a,{url:body.url,login:body.login,hasPassword:true,hasLinkedIn:true});const t=tasks.get(id)!;t.version++;return structuredClone(t);},
    async status(id:number,body:any){id=Number(id);const t=tasks.get(id)!;t.status=body.status;t.version++;return structuredClone(t);},
    async secrets(){return{password:'mock-only'};},key(){return{key:'mock-only'};}
  } as unknown as CreationTaskService;
  const app:import('express').Express=createWebConsoleApp({useMockData:true,repository,octoService:runtime.service,linkedinIntake:intake,linkedinProxyMove:moveService,
    linkedinCreator:creator,linkedinCreatorAuth:{login:'local-denis',password:'local-test-only'}});
  await profiles.setCoverage(Date.now()-10000);await runtime.start();
  return{app,profiles,cloud,api,runtime,moves,notices,accounts,advanceClock(ms:number){clockOffset+=ms;},async close(){await runtime.stop();}};
}

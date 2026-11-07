const {createPlaywrightCaptchaAdapters}=require('./playwright-adapter.ts')
const {solveCaptcha}=require('./solve.ts')
type RecordRow = Record<string, any>

function activeProfilePorts(records: RecordRow[]) {
 const ports=new Map<number,{port:number;name:string}>(), finished=new Set<number>()
 for(const row of records){
  if(row.kind==='client-final-status')finished.add(Number(row.status?.dolphinProfileId))
  if(row.kind==='client-lifecycle'&&row.event?.event==='Dolphin profile started'){
   const id=Number(row.dolphinProfileId),port=Number(row.event.details?.match(/port (\d+)/)?.[1])
   if(Number.isInteger(id)&&id>0&&Number.isInteger(port)&&port>0&&port<=65535)ports.set(id,{port,name:row.clientName})
  }
 }
 for(const id of finished)ports.delete(id)
 return ports
}

// Only attaches to profiles started by this specific normal-orchestrator log.
// The caller owns ledger IO, image storage, recognition and result persistence.
function createCaptchaSupervisor(dependencies: {
 readRecords(): RecordRow[]
 chromium: any
 save(image: {id:string;bytes:Buffer}, attempt:number, profileId:number): Promise<unknown>
 recognize(bytes:Buffer, context:any): Promise<string>
 onState?(state:any): void
 onResult?(result:any): void
 createAdapters?: typeof createPlaywrightCaptchaAdapters
 solve?: typeof solveCaptcha
}) {
 const connections=new Map<number,any>(), pages=new Map<number,any>(), jobs=new Map<number,any>()
 const state={busy:false,lastTick:'',error:undefined as string|undefined,active:[] as any[]}
 let timer:ReturnType<typeof setInterval>|undefined
 const createAdapters=dependencies.createAdapters??createPlaywrightCaptchaAdapters
 const solve=dependencies.solve??solveCaptcha
 function startJob(id:number){
  if(jobs.get(id)&&!jobs.get(id).finished)return
  const page=pages.get(id);if(!page)return
  const previous=jobs.get(id)
  const captureRetries=previous?.finished&&!previous.lastHash?(previous.captureRetries??0)+1:0
  const job={profileId:id,startedAt:new Date().toISOString(),finished:false,result:undefined as any,lastHash:undefined as string|undefined,captureRetries,finishedAt:undefined as number|undefined}
  jobs.set(id,job)
  const adapters=createAdapters(page,{
   save:(image:any,attempt:number)=>{job.lastHash=image.id;return dependencies.save(image,attempt,id)},
   recognize:(bytes:Buffer,context:any)=>dependencies.recognize(bytes,{...context,profileId:id})
  })
  solve(adapters,{timeoutMs:240000,maxAttempts:3}).then((result:any)=>{
   job.finished=true;job.finishedAt=Date.now();job.result=result;dependencies.onResult?.({...job,finishedAt:new Date().toISOString()})
  }).catch((error:Error)=>{job.finished=true;job.finishedAt=Date.now();job.result={solved:false,reason:error.message};dependencies.onResult?.({...job})})
 }
 async function probe(page:any){
  let timeout:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([page.evaluate(()=>({
   path:location.pathname,panel:!!document.getElementById('ar-main-panel'),
   running:sessionStorage.getItem('hh_ar_v2_is_active'),
   count:Number(sessionStorage.getItem('hh_ar_v2_successful_responses')||0),
   reason:sessionStorage.getItem('hh_ar_v2_stop_reason'),
   captcha:[...document.querySelectorAll('input,img,canvas,[data-qa*=captcha]')].some((element:any)=>{
    const rect=element.getBoundingClientRect()
    return rect.width>0&&rect.height>0&&/captcha|капч/i.test([element.name,element.id,element.getAttribute('data-qa'),element.getAttribute('src'),element.getAttribute('placeholder')].join(' '))
   })
  })),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('captcha_probe_timeout')),2500)})])}
  finally{if(timeout)clearTimeout(timeout)}
 }
 async function tick(){
  if(state.busy)return
  state.busy=true
  try{
   const active=[]
   for(const[id,info]of activeProfilePorts(dependencies.readRecords())){
    try{
     let browser=connections.get(id)
     if(!browser?.isConnected()){browser=await dependencies.chromium.connectOverCDP('http://127.0.0.1:'+info.port,{timeout:3000});connections.set(id,browser)}
     const hhPages=browser.contexts()[0].pages().filter((page:any)=>/^https:\/\/([\w-]+\.)?hh\.ru\//i.test(page.url()))
     const results=await Promise.allSettled(hhPages.map(probe))
     const valid=results.flatMap((result:any,i:number)=>result.status==='fulfilled'?[{page:hhPages[i],data:result.value}]:[])
     const current=valid.find((x:any)=>x.data.panel&&x.data.running==='1')??valid.find((x:any)=>x.data.captcha)??valid.find((x:any)=>x.data.panel)??valid.at(-1)
     if(!current){active.push({id,...info,phase:'loading'});continue}
     pages.set(id,current.page);active.push({id,...info,...current.data})
     const previous=jobs.get(id)
     if(current.data.captcha){
      if(!previous||(previous.finished&&previous.result?.solved))startJob(id)
      else if(previous.finished&&!previous.lastHash&&previous.captureRetries<2&&Date.now()-(previous.finishedAt??0)>=15000)startJob(id)
      else if(previous.finished&&previous.lastHash){
       // An accepted answer can navigate before the click acknowledgement.
       // A different image is a new/reissued challenge, never a resend of the
       // application or of an answer for the old image.
       const image=await createAdapters(current.page,{save:async()=>undefined,recognize:async()=>''}).capture({timeoutMs:3000})
       if(image.id!==previous.lastHash)startJob(id)
      }
     }
    }catch(error:any){active.push({id,...info,error:error.message?.split('\n')[0]})}
   }
   state.active=active;state.lastTick=new Date().toISOString();state.error=undefined
   dependencies.onState?.(state)
  }catch(error:any){state.error=error.message}
  finally{state.busy=false}
 }
 return {state,jobs,pages,tick,retry:startJob,
  start(){if(!timer)timer=setInterval(()=>{void tick()},5000);void tick()},
  stop(){if(timer)clearInterval(timer);timer=undefined}
 }
}
module.exports={activeProfilePorts,createCaptchaSupervisor}

type AuthCheck = import('../orchestrator/types.ts').HhAuthCheck
async function waitForCaptchaAuth(page: {isClosed(): boolean}, initial: AuthCheck, dependencies: {
 detect(page: any): Promise<AuthCheck>
 now?(): number
 sleep?(ms: number): Promise<void>
 timeoutMs?: number
}): Promise<AuthCheck> {
 const now=dependencies.now??Date.now
 const sleep=dependencies.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)))
 const end=now()+(dependencies.timeoutMs??300000)
 let check=initial
 while(!page.isClosed()&&now()<end){
  await sleep(Math.min(500,end-now()))
  if(now()>=end)break
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   const next=await Promise.race([dependencies.detect(page),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),Math.min(5000,Math.max(1,end-now())))})])
   if(next&&next.state!=='unknown')check=next
   if(check.state!=='captcha')return check
  }catch{/* Read-only probes can race with the captcha navigation. */}
  finally{if(timer)clearTimeout(timer)}
 }
 return check
}
module.exports={waitForCaptchaAuth}

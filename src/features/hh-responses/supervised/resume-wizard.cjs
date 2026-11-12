const {activeProfilePorts}=require('../captcha/supervisor.ts');
function shouldStopResumeWizard({pathname,running,count,since,now}) {
  return /^\/profile\/resume\/title\/?$/.test(pathname)&&running==='1'&&count===0&&now-since>=90000;
}
function createResumeWizardGuard(chromium,onIntervention=()=>{}) {
  const seen=new Map();
  const bounded=async operation=>{let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('resume_guard_timeout')),5000)})]);}finally{clearTimeout(timer);}};
  return async rows=>{
    for(const [id,{port}] of activeProfilePorts(rows)){
      let browser,timer;
      try{
        browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:3000});
        for(const page of browser.contexts()[0].pages()){
          if(!/^https:\/\/([\w-]+\.)?hh\.ru\/profile\/resume\/title\/?(?:\?|$)/i.test(page.url()))continue;
          const value=await Promise.race([page.evaluate(()=>({pathname:location.pathname,running:sessionStorage.getItem('hh_ar_v2_is_active'),count:Number(sessionStorage.getItem('hh_ar_v2_successful_responses')||0)})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('probe_timeout')),2500)})]);clearTimeout(timer);
          const key=id+':'+page.url(),now=Date.now();
          if(value.running!=='1'||value.count!==0){seen.delete(key);continue;}
          if(!seen.has(key))seen.set(key,now);
          if(shouldStopResumeWizard({...value,now,since:seen.get(key)})){await bounded(page.close({runBeforeUnload:false}));seen.delete(key);onIntervention({profileId:id,reason:'resume_setup_required'});}
        }
      }catch{}finally{clearTimeout(timer);if(browser)await bounded(browser.close()).catch(()=>{});}
    }
  };
}
module.exports={shouldStopResumeWizard,createResumeWizardGuard};

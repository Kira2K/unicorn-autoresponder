import type {BrowserContext,Page} from 'playwright';
/** Install before navigation: video must never capture proxy fields or temporary access secrets. */
export async function protectRecording(context:BrowserContext){
 await context.addInitScript(()=>{
  const install=()=>{
   if(!document.documentElement)return;
   const style=document.createElement('style');style.dataset.e2eRecording='protected';
   style.textContent=`input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea{-webkit-text-security:disc!important}
    .octo-credentials{position:relative!important;min-height:70px}
    .octo-credentials>*{opacity:0!important}
    .octo-credentials::after{content:'Реквизиты доступа скрыты на записи';position:absolute;inset:0;display:grid;place-items:center;background:#e2e8f0;color:#334155;border-radius:8px;pointer-events:none}
    .topbar p,.dashboard-header p,.hero p,.octo-proxy>p:first-of-type,.task-button__title,.task-button__meta{visibility:hidden!important}`;
   document.documentElement.append(style);
  };
  if(document.documentElement)install();else new MutationObserver((_,observer)=>{if(document.documentElement){install();observer.disconnect();}}).observe(document,{childList:true,subtree:true});
 });
}
/** A visible chapter label, derived by the runner from the stage actually being executed. */
export async function recordingStage(page:Page,text:string){
 await page.evaluate(value=>{
  let banner=document.getElementById('e2e-recording-stage');if(!banner){banner=document.createElement('div');banner.id='e2e-recording-stage';banner.style.cssText='position:fixed;left:10px;bottom:10px;z-index:2147483647;padding:10px 16px;border-radius:8px;background:#0f172a;color:#fff;font:16px sans-serif;pointer-events:none';document.body.append(banner);}banner.textContent=value;
 },text);
}

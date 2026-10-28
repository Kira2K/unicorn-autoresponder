import type {Browser,BrowserContext,Page} from 'playwright';import {consoleUrl} from './context.mts';
import {resolve} from 'node:path';import type {RunJournal} from './journal.mts';
export async function loginCycleUser(browser:Browser,email:string,password:string){
 const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Tbilisi'}),page=await context.newPage();page.setDefaultTimeout(20000);
 await page.goto(consoleUrl);await page.getByTestId('email-input').fill(email);await page.locator('#password').fill(password);await page.getByTestId('login-button').click();
 await page.getByTestId('login-button').waitFor({state:'hidden'});
 if(await page.getByTestId('octo-welcome').waitFor({timeout:4000}).then(()=>true,()=>false))await page.getByRole('button',{name:'Понятно, продолжить',exact:true}).click();
 return{context,page};
}
export async function readJson(context:BrowserContext,path:string){const r=await context.request.get(consoleUrl+path);if(!r.ok())throw Error('e2e_read_request_failed');return r.json();}
export async function waitForCycle(fn:()=>Promise<boolean>,code:string,timeout=180000){
 const end=Date.now()+timeout;do{if(await fn())return;await new Promise(r=>setTimeout(r,1500));}while(Date.now()<end);throw Error(code);
}
export async function evidenceScreenshot(page:Page,journal:RunJournal,name:string){
 const path=resolve(journal.dir,name+'.png');
 await page.screenshot({path,fullPage:true,mask:[page.locator('input[type=password]'),page.locator('.octo-proxy-form input'),page.locator('.octo-credentials')]});return path;
}
export async function submitAndRead(page:Page,path:string,click:()=>Promise<void>){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname===path&&['PUT','POST'].includes(r.request().method()));
 await click();const r=await response;if(!r.ok())throw Error('e2e_form_request_rejected');return r.json();
}

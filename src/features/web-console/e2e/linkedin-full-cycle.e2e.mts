import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {parseCycleArgs} from './linkedin-full-cycle/contracts.mts';
import {openCycleJournal} from './linkedin-full-cycle/journal.mts';
import {cycleContext} from './linkedin-full-cycle/context.mts';
import {cyclePreflight} from './linkedin-full-cycle/preflight.mts';
import {lockCycleRun} from './linkedin-full-cycle/run-lock.mts';
export async function runFullCycle(args:string[],env:NodeJS.ProcessEnv){
 const options=parseCycleArgs(args),journal=await openCycleJournal(options.runId),release=await lockCycleRun(journal.dir);
 let context:Awaited<ReturnType<typeof cycleContext>>|undefined;
 try{
  context=await cycleContext(env);
  const preflight=await cyclePreflight(context);
  journal.data.checks=journal.data.checks.filter(c=>!preflight.checks.some(p=>p.step===c.step));journal.data.checks.push(...preflight.checks);await journal.save();
  console.log(JSON.stringify({runId:journal.data.runId,mode:options.apply?'apply':'preflight',passed:preflight.passed,checks:preflight.checks.map(c=>({step:c.step,state:c.state,code:c.actual}))}));
  if(!preflight.passed){process.exitCode=2;return;}
  if(options.apply){const {runBrowserCycles}=await import('./linkedin-full-cycle/browser.mts');await runBrowserCycles(context,journal,preflight.connections);if(!journal.data.passed)process.exitCode=2;}
 }finally{try{await context?.close();}finally{await release();}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await runFullCycle(process.argv.slice(2),process.env);}catch(e){console.error(JSON.stringify({error:/^e2e_[a-z_]+$/.test((e as Error).message)?(e as Error).message:'e2e_unexpected_failure'}));process.exitCode=1;}
}

import type {Express,RequestHandler} from 'express'
import {timingSafeEqual} from 'node:crypto'
import type {LinkedInOrchestrator} from '../../linkedin-automation/orchestrator/service.ts'
import {safeCode} from '../../linkedin-automation/orchestrator/audit.ts'
import {explain} from '../../linkedin-automation/orchestrator/diagnostics.ts'
export function registerLinkedInAutomationRoutes(app:Express,admin:RequestHandler,service:LinkedInOrchestrator|undefined,
  readToken?:string,unavailableCode='automation_not_configured') {
  const base='/api/admin/linkedin/automation'
  const readAccess:RequestHandler=(req,res,next)=>{
    const supplied=String(req.headers.authorization??'').replace(/^Bearer /,'')
    if(readToken && readToken.length>=32 && Buffer.byteLength(supplied)===Buffer.byteLength(readToken) &&
      timingSafeEqual(Buffer.from(supplied),Buffer.from(readToken))) {next();return}
    admin(req,res,next)
  }
  const wrap=(fn:(req:any)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    if(!service){res.status(503).json({error:unavailableCode,message:explain(unavailableCode)});return}
    try{res.json(await fn(req))}catch(error){const code=safeCode((error as any)?.code,'automation_request_failed');
      res.status(code.includes('conflict')?409:400).json({error:code,message:explain(code)})}
  }
  const id=(value:any)=>{if(value===undefined)return undefined;const n=Number(value);
    if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(n)||n<=0)throw Object.assign(Error(),{code:'automation_account_invalid'});return n}
  app.get(base,readAccess,wrap(req=>service!.snapshot(id(req.query.account))))
  app.get(`${base}/diagnostics`,readAccess,wrap(req=>service!.diagnostics({account:id(req.query.account),
    runKey:typeof req.query.runKey==='string'?req.query.runKey:undefined,before:id(req.query.before),limit:Math.min(id(req.query.limit)??100,500)})))
  app.put(`${base}/:account`,admin,wrap(req=>service!.update(id(req.params.account)!,req.body?.settings,req.body?.revision)))
  app.post(`${base}/bulk`,admin,wrap(req=>service!.bulk(req.body?.items)))
}

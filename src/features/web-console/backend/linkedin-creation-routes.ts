import type { Express, Request, RequestHandler } from 'express';
import type { CreationTaskService } from '../../linkedin-automation/creation-tasks/service.mts';
type AuthRequest = Request & { webSession?: { role: string } };
export function registerCreationTaskRoutes(app: Express, requireAuth: RequestHandler, service?: CreationTaskService) {
  const handle = (run: (s: CreationTaskService, r: Request) => unknown): RequestHandler => async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control','no-store');
    if (req.webSession?.role !== 'linkedin_creator' || !service) { res.status(403).json({error:'forbidden'}); return; }
    try { res.json(await run(service,req)); }
    catch(error) {
      const e=error as {code?:string;status?:number};
      const code=/^(linkedin_task_|linkedin_intake_|octo_|invalid_proxy_fields$|forbidden$|commit_uncertain$)/.test(e.code||'') ? e.code! : 'linkedin_task_unavailable';
      res.status(e.status || (code==='forbidden'?403:code==='linkedin_task_not_found'?404:['linkedin_task_unavailable','commit_uncertain'].includes(code)?503:409)).json({error:code});
    }
  };
  const base='/api/linkedin-creator';
  app.get(base+'/tasks',requireAuth,handle(s=>s.list()));
  app.post(base+'/nodemaven-key',requireAuth,handle(s=>s.key()));
  app.get(base+'/tasks/:id',requireAuth,handle((s,r)=>s.detail(r.params.id)));
  app.get(base+'/tasks/:id/secrets/:kind',requireAuth,handle((s,r)=>s.secrets(r.params.id,r.params.kind)));
  app.put(base+'/tasks/:id/result',requireAuth,handle((s,r)=>s.result(r.params.id,r.body??{})));
  app.put(base+'/tasks/:id/status',requireAuth,handle((s,r)=>s.status(r.params.id,r.body??{})));
  app.post(base+'/tasks/:id/capture-proxy',requireAuth,handle((s,r)=>s.capture(r.params.id,r.body??{})));
  app.get(base+'/tasks/:id/octo/status',requireAuth,handle((s,r)=>s.profileStatus(r.params.id,r.query.proxyCredentials==='1')));
  app.post(base+'/tasks/:id/octo/grants',requireAuth,handle((s,r)=>s.acquire(r.params.id,r.body?.profileId)));
  app.post(base+'/tasks/:id/octo/profiles/:profile/proxy',requireAuth,handle((s,r)=>s.saveProxy(r.params.id,r.params.profile,r.body)));
  app.get(base+'/tasks/:id/octo/grants/:grant',requireAuth,handle((s,r)=>s.grant(r.params.id,String(r.params.grant))));
}

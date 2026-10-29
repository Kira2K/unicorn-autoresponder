import type {Express,Request,RequestHandler} from 'express';
import type {CreationTaskService} from '../../linkedin-automation/creation-tasks/service.mts';
type AuthRequest=Request&{webSession?:{role:string}};
export function registerAdminCreationTaskRoutes(app:Express,requireAuth:RequestHandler,service?:CreationTaskService){
  const handle=(run:(s:CreationTaskService,req:Request)=>unknown):RequestHandler=>async(req:AuthRequest,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.webSession?.role!=='admin'||!service){res.status(403).json({error:'forbidden'});return;}
    try{res.json(await run(service,req));}
    catch(error){const e=error as {code?:string;status?:number};
      const code=/^(linkedin_task_|linkedin_intake_|octo_|forbidden$|commit_uncertain$)/.test(e.code||'')?e.code!:'linkedin_task_unavailable';
      res.status(e.status||(code==='forbidden'?403:code==='linkedin_task_not_found'?404:['commit_uncertain','linkedin_task_unavailable'].includes(code)?503:409)).json({error:code});}
  };
  const base='/api/admin/linkedin-creation/tasks';
  app.get('/api/admin/linkedin-creation/config',requireAuth,handle(s=>s.notificationConfig()));
  app.get(base,requireAuth,handle(s=>s.adminList()));
  app.get(base+'/:id',requireAuth,handle((s,r)=>s.adminDetail(r.params.id)));
  app.post(base+'/:id/confirm',requireAuth,handle((s,r)=>s.confirm(r.params.id,r.body??{})));
  app.get(base+'/:id/octo/status',requireAuth,handle((s,r)=>s.adminProfileStatus(r.params.id,r.query.proxyCredentials==='1')));
}

import type { Express, Request, RequestHandler } from 'express';
import type { LinkedInIntakeService } from '../../linkedin-automation/console-intake/service.mts';
import {safeClientFields} from '../../linkedin-automation/console-intake/contracts.mts';
type AuthRequest = Request & { webSession?: { role: string; clientId?: number } };
export function registerLinkedInIntakeRoutes(app: Express, requireAuth: RequestHandler, service?: LinkedInIntakeService) {
  const handle = (save: boolean,ban=false,cancelBan=false): RequestHandler => async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = req.webSession?.clientId;
    if (!service || req.webSession?.role !== 'client' || !id) { res.status(403).json({ error: 'forbidden' }); return; }
    try { res.json(await (cancelBan?service.cancelBan(Number(id),req.body):ban?service.reportBan(Number(id),req.body):save ? service.save(Number(id), req.body) : service.load(Number(id)))); }
    catch (error) {
      const e = error as { code?: string; status?: number;fields?:Array<{field:string}> };
      const code = /^(linkedin_intake_|linkedin_task_|octo_|forbidden$|commit_uncertain$)/.test(e.code || '') ? e.code! : 'linkedin_intake_unavailable';
      res.status(e.status || (code === 'forbidden' ? 403 : ['linkedin_intake_unavailable','commit_uncertain'].includes(code) ? 503 : 409)).json({ error: code,
        ...(code==='octo_client_data_required'?{fields:safeClientFields(e.fields?.map(item=>item.field))}:{}) });
    }
  };
  app.get('/api/client/linkedin-intake', requireAuth, handle(false));
  app.put('/api/client/linkedin-intake', requireAuth, handle(true));
  app.post('/api/client/linkedin-intake/ban',requireAuth,handle(false,true));
  app.delete('/api/client/linkedin-intake/ban',requireAuth,handle(false,false,true));
}

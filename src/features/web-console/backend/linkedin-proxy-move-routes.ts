import type {Express,Request,RequestHandler} from 'express';
import type {ProxyMoveService} from '../../linkedin-automation/proxy-move/service.mts';
import {publicCountryFailure} from '../../linkedin-automation/proxy-move/checked-proxy.mts';
export function registerProxyMoveRoutes(app:Express,auth:RequestHandler,service?:ProxyMoveService) {
  const handle=(action:'status'|'replace'|'finish'):RequestHandler=>async(req:Request&{webSession?:{role:string;clientId?:number}},res)=>{
    res.setHeader('Cache-Control','no-store');
    const id=req.webSession?.clientId;
    if(!id||req.webSession?.role!=='client'){res.status(403).json({error:'forbidden'});return;}
    if(!service){res.status(503).json({error:'linkedin_proxy_move_unavailable'});return;}
    try{res.json(await(action==='status'?service.status(id):service[action](id,req.body)));}
    catch(error){const code=String((error as {code?:unknown}).code||'');
      const safe=/^(linkedin_proxy_move_|octo_proxy_check_|invalid_proxy_|commit_uncertain$)/.test(code)?code:'linkedin_proxy_move_unavailable';
      res.status(safe.endsWith('_forbidden')?403:safe.endsWith('_unavailable')||safe==='commit_uncertain'?503:409).json({error:safe,...(publicCountryFailure(error)?{proxyCheck:publicCountryFailure(error)}:{})});}
  };
  app.get('/api/client/linkedin-proxy-move',auth,handle('status'));
  app.post('/api/client/linkedin-proxy-move/proxy',auth,handle('replace'));
  app.post('/api/client/linkedin-proxy-move/finish',auth,handle('finish'));
}

import type {OctoService} from '../../octo-access/service.mts';
import type {ProxyMoveService} from './service.mts';
/** Compose the student HTTP boundary; staff and unrelated profiles retain their existing path. */
export function guardStudentProxy(octo:OctoService,moves:ProxyMoveService):OctoService{
 return{...octo,
 async startOnboarding(clientId,input){await moves.assertSetupAllowed(clientId);return octo.startOnboarding(clientId,input);},
 async continueOnboarding(clientId,id,accept){await moves.assertSetupAllowed(clientId);return octo.continueOnboarding(clientId,id,accept);},
 async saveProxy(clientId,profileId,input,isMadeByExpert=false){
  if(!isMadeByExpert&&Number.isSafeInteger(profileId)&&profileId>0){
   const result=await moves.replaceProfile(clientId,profileId,input);
   if(result)return{...await octo.status(clientId),proxyCheck:result.proxyCheck};
  }
  return octo.saveProxy(clientId,profileId,input,isMadeByExpert);
 }};
}

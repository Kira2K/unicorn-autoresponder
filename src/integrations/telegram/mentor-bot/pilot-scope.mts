import type {State} from './types.mts';
import type {TestConfig} from './test-config.mts';
import {testBinding} from './test-config.mts';

export type PilotScope={clientId:string;binding:string;studentUsername:string;chatId:string;reportChatId:string;
  hardMentor:string;softMentor:string;useTestChat?:boolean};
export function pilotScope(config:TestConfig,chatId:string,options:{useTestChat?:boolean}={}):PilotScope{
  const binding=testBinding(config,chatId);
  return {clientId:config.clientId,binding:options.useTestChat?JSON.stringify({testBinding:binding,useTestChat:true}):binding,studentUsername:config.studentUsername,
    chatId,reportChatId:config.reportChatId,hardMentor:config.hardMentorUsername?'@'+config.hardMentorUsername:'',
    softMentor:config.softMentorUsername?'@'+config.softMentorUsername:'',...(options.useTestChat?{useTestChat:true}:{})};
}
/** Explicit pilot routing leaves the canonical card's chat untouched. Destination guards still apply. */
export function pilotChatSafe(sourceChatId:string,scope:PilotScope):boolean{
  return scope.useTestChat===true||!sourceChatId||sourceChatId===scope.chatId;
}
/** The namespace is derived from a validated numeric ID, never an arbitrary SQL identifier. */
export function pilotSchema(scope:PilotScope):string{
  if(!/^[1-9]\d*$/.test(scope.clientId)||!Number.isSafeInteger(Number(scope.clientId)))
    throw new Error('mentor_pilot_client_invalid');
  return 'mentor_bot_pilot_'+scope.clientId;
}
/** Check loaded data and proposed mutations before issuing any write, including queue receipts. */
export function assertPilotState(state:State,scope:PilotScope):void{
  const own=(id:string)=>{if(id!==scope.clientId)throw new Error('mentor_pilot_client_scope');};
  for(const [id,c] of Object.entries(state.clients)){own(id);own(c.id);
    if(c.chatId!==scope.chatId||c.username!=='@'+scope.studentUsername)throw new Error('mentor_pilot_binding');}
  for(const [id,l] of Object.entries(state.learners)){own(id);own(l.clientId);}
  for(const table of ['sessions','checkins','history'] as const)
    for(const row of Object.values(state[table])){own(row.clientId);
      if('chatId' in row&&row.chatId!==scope.chatId)throw new Error('mentor_pilot_binding');}
  for(const event of state.sourceEvents)own(event.clientId);
  for(const d of Object.values(state.deliveries)){
    if(d.clientId!==undefined)own(d.clientId);
    if(![scope.chatId,scope.reportChatId].includes(d.input.chatId))throw new Error('mentor_pilot_destination');
  }
}

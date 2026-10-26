import type {Input, State} from './types.mts';
import {enqueue} from './messages.mts';
import {username} from './policy.mts';

/** Fold this interaction's student notices into its editable screen; reports and scheduled events keep their routes. */
export function combineDialogueFeedback(state:State,input:Input,previousDeliveries:ReadonlySet<string>,now:number):void {
  const session=Object.values(state.sessions).find(s=>s.chatId===input.chatId&&s.owner===username(input.username));
  if(!session?.messageId)return;
  const feedback=Object.values(state.deliveries).filter(d=>!previousDeliveries.has(d.id)&&d.clientId===session.clientId&&
    d.input.chatId===session.chatId&&(d.kind==='notice'||d.kind==='instruction')&&d.state==='pending');
  const inherited=Object.values(state.deliveries).filter(d=>previousDeliveries.has(d.id)&&d.kind==='screen'&&
    (d.sessionId===session.id||d.input.editMessageId===session.messageId)&&d.input.chatId===session.chatId&&
    (d.state==='pending'||d.state==='sending')&&d.template?.type==='screen'&&d.template.feedback?.length);
  const templates=[...inherited.flatMap(d=>d.template?.type==='screen'?d.template.feedback??[]:[]),
    ...feedback.map(d=>d.template??{type:'notice' as const,text:d.input.text})];
  if(!templates.length)return;
  const id='update:'+input.updateId+':screen';
  if(!state.deliveries[id]){
    session.revision++;
    enqueue(state,{id,clientId:session.clientId,kind:'screen',sessionId:session.id,sessionRevision:session.revision,
      checkinId:session.checkinId,template:{type:'screen'},input:{chatId:session.chatId,text:'',editMessageId:session.messageId}},now);
  }
  state.deliveries[id].template={type:'screen',feedback:templates};
  for(const delivery of [...feedback,...inherited])if(delivery.id!==id)delivery.state='cancelled';
}

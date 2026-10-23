function bindSender(state,settings,clientId){
 const selected=settings.senderOverrides?.[clientId]||settings.sender||'bot';
 if(!['owner','bot'].includes(selected))throw Error('invalid_restoration_sender');
 if(state.senderMode&&state.senderMode!==selected&&Object.values(state.deliveries||{}).some(d=>d.done||d.intentAt))throw Error('restoration_sender_changed');
 if(!state.senderMode&&Object.values(state.deliveries||{}).some(d=>d.done)&&selected!==(settings.sender||'bot'))throw Error('sender_override_requires_unsent_group');
 state.senderMode=selected;return selected;
}
module.exports={bindSender};

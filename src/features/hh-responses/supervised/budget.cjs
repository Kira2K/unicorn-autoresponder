function createBudget({maxCalls,tokenBudget,reserveTokens}) {
  let calls=0,input=0,output=0,cached=0,reserved=0,unknown=0,closed=false;
  const pending=new Set();
  return {
    reserve(){
      if(closed||calls>=maxCalls||input+output+reserved+reserveTokens>tokenBudget)throw Error('captcha_budget_closed');
      const ticket={};calls++;reserved+=reserveTokens;pending.add(ticket);return ticket;
    },
    settle(ticket,usage){
      if(!pending.delete(ticket))throw Error('captcha_budget_ticket_invalid');
      reserved-=reserveTokens;
      if(!usage){unknown++;reserved+=reserveTokens;closed=true;return;}
      const valid=['input_tokens','output_tokens','cached_input_tokens'].every(k=>Number.isSafeInteger(usage[k]??0)&&(usage[k]??0)>=0);
      if(!valid||(usage.cached_input_tokens??0)>usage.input_tokens){unknown++;reserved+=reserveTokens;closed=true;return;}
      input+=usage.input_tokens;output+=usage.output_tokens;cached+=usage.cached_input_tokens??0;
      if(calls>=maxCalls||input+output+reserved>=tokenBudget)closed=true;
    },
    close(){closed=true;},
    snapshot(){return {calls,maxCalls,knownInputTokens:input,knownOutputTokens:output,cachedInputTokens:cached,knownTotalTokens:input+output,unknownUsageCalls:unknown,reservedTokens:reserved,tokenBudget,closed,pending:pending.size};}
  };
}
module.exports={createBudget};

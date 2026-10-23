const {accountGate}=require('./account-gate.cjs');
function sourceReader(a){const gate=accountGate({...a,delay:1000});return request=>{
 if(!/^(?:get|search|load|download)/.test(request._||''))throw Error('stack_source_read_only');
 return gate(async()=>{try{return await a.invoke(request);}catch(e){const seconds=Number(String(e.message||'').match(/(?:retry after|FLOOD_WAIT_?)\s*(\d+)/i)?.[1]||0);if(seconds){e.errorMessage='FLOOD_WAIT_'+seconds;e.seconds=seconds;}else if(Number(e.code)===429)e.errorMessage='FLOOD';throw e;}});
};}
module.exports={sourceReader};

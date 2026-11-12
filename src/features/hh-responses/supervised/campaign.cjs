// This module controls only sequencing. Existing workers own applications,
// reports and cleanup; no business action is replayed here.
async function runCampaign(options,{check,runMarket,save,report}) {
  const state={startedAt:new Date().toISOString(),phase:'preflight',markets:[]};save(state);
  try{
    state.preflight=await check();if(!state.preflight.ok)throw Error('hh_service_preflight_failed');
    for(const market of options.markets){
      state.phase='running';state.market=market;save(state);
      const result=await runMarket(market);state.markets.push({market,...result});save(state);
      if(result.exitCode!==0)throw Error('hh_market_process_failed');
      if(!result.cleanupComplete)throw Error('hh_cleanup_unconfirmed');
      if(!result.providerHealthy)throw Error('hh_recognizer_unhealthy');
      if(!result.deliveryComplete)throw Error('hh_report_delivery_unconfirmed');
    }
    state.phase=state.markets.some(m=>m.clientErrors>0)?'completed_with_client_errors':'complete';
  }catch(error){state.phase='failed';state.error=/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_campaign_failed';}
  state.endedAt=new Date().toISOString();save(state);
  try{state.summaryDelivered=await report(state);}catch{state.summaryDelivered=false;}
  if(!state.summaryDelivered){state.phase='failed';state.error=state.error??'hh_summary_delivery_unconfirmed';}
  save(state);return state;
}
module.exports={runCampaign};

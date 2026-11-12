const path=require('node:path');
const {loadConfiguration}=require('./config.cjs');
const {preflight,applyRuntimeEnvironment,sendStateReport,writeJson}=require('./services.cjs');
async function main(args=process.argv.slice(2)){
  let config;
  try{
    config=loadConfiguration(args);applyRuntimeEnvironment(config);
    const {createRecognizer}=require('./recognizer.cjs');
    const proof=await preflight(config,createRecognizer(config));
    const file=path.join(config.root,'logs/hh-service-checks',new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    writeJson(file,proof);
    if(!proof.ok)proof.alertSent=await sendStateReport(config,'HH service check failed: '+proof.checks.filter(x=>!x.ok).map(x=>x.name+'/'+x.code).join(', '));
    writeJson(file,proof);console.log(JSON.stringify({file,...proof}));return proof.ok?0:1;
  }catch(error){
    const code=/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_service_check_failed';
    if(config)await sendStateReport(config,'HH service check failed: '+code).catch(()=>false);
    console.error(code);return 1;
  }
}
if(require.main===module)main().then(code=>{process.exitCode=code;});
module.exports={main};

const fs=require('node:fs'),path=require('node:path');
const folder=path.resolve(__dirname,'../../../storage/group-restoration-v2'),pid=Number(process.argv[2]);
let timer;
function check(){
 try{
  const r=JSON.parse(fs.readFileSync(path.join(folder,'report.json')));
  const summary={at:r.at,complete:r.groups.filter(g=>g.status==='complete').length,inProgress:r.groups.filter(g=>g.status==='in_progress').length,pending:r.groups.filter(g=>g.status==='pending').length,failed:r.groups.filter(g=>g.error&&g.status!=='complete').map(g=>({clientId:g.clientId,error:g.error}))};
  console.log(JSON.stringify(summary));
  if(fs.existsSync(path.join(folder,'completed.json'))){clearInterval(timer);process.exitCode=0;return;}
  try{process.kill(pid,0);}catch{clearInterval(timer);console.log(JSON.stringify({event:'batch_process_stopped'}));process.exitCode=1;}
 }catch(e){console.log(JSON.stringify({event:'monitor_read_failed',code:e.code||e.name}));}
}
timer=setInterval(check,50000);check();

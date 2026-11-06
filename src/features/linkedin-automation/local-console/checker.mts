import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {checkProxyCheckerConnection} from '../../octo-access/checker-preflight.mts';
const base=process.env.LINKEDIN_LOCAL_CHECKER_URL||'http://127.0.0.1:8002',url=new URL(base);
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:'||url.pathname!=='/')throw Error('linkedin_local_checker_loopback_required');
if(!process.env.UNICORN_PROXY_CHECKER_SECRET_KEY)throw Error('linkedin_local_checker_secret_required');
const directory=process.env.LINKEDIN_LOCAL_CHECKER_DIR||'C:/Users/kiras/proxy_checker_client',python=resolve(directory,'.venv/Scripts/python.exe');
try{console.log(JSON.stringify(await checkProxyCheckerConnection({...process.env,PROXY_CHECKER_BASE_URL:base})));}
catch{
  const healthy=await fetch(base+'/health',{signal:AbortSignal.timeout(2000)}).then(()=>true,()=>false);
  if(healthy)throw Error('linkedin_local_checker_port_occupied');
  if(!existsSync(python))throw Error('linkedin_local_checker_python_required');
  const child=spawn(python,['-m','uvicorn','api:app','--host','127.0.0.1','--port',url.port||'8002','--workers','1','--no-access-log'],
    {cwd:directory,windowsHide:true,stdio:['ignore','inherit','inherit'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  child.once('error',()=>{console.error('linkedin_local_checker_start_failed');process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
  process.once('SIGINT',()=>child.kill());process.once('SIGTERM',()=>child.kill());
  console.log('Локальный checker запущен на 127.0.0.1; журналы запросов отключены.');
}

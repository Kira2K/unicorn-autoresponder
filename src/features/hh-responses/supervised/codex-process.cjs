const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
function resolveCodex(executable) {
  if(executable){
    if(!path.isAbsolute(executable)||!fs.statSync(executable,{throwIfNoEntry:false})?.isFile())throw Error('captcha_cli_missing');
    return /\.m?js$/i.test(executable)?{command:process.execPath,prefix:[executable]}:{command:executable,prefix:[]};
  }
  // The pinned project CLI works on a VDS without a VS Code extension.
  try{return {command:process.execPath,prefix:[require.resolve('@openai/codex/bin/codex.js')]};}
  catch{throw Error('captcha_cli_missing');}
}
function isolatedEnvironment(env=process.env) {
  const allowed=new Set(['SYSTEMROOT','WINDIR','TEMP','TMP','PATH','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','COMSPEC','CODEX_HOME','HOME','LANG','LC_ALL','SSL_CERT_FILE','CODEX_CA_CERTIFICATE']);
  return Object.fromEntries(Object.entries(env).filter(([k])=>allowed.has(k.toUpperCase())));
}
function killOwnedChild(child) {
  if(!child.pid||child.exitCode!==null&&child.exitCode!==undefined)return;
  if(process.platform==='win32'){
    try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});return;}catch{}
  }else{try{process.kill(-child.pid,'SIGTERM');return;}catch{}}
  child.kill();
}
function runCodex(invocation,args,{cwd,signal,timeoutMs=10000,onEvent=()=>{},input='',spawnProcess=spawn,kill=killOwnedChild}={}) {
  return new Promise((resolve,reject)=>{
    let child,timer,settled=false,buffer='',stdout='',stderr='';
    const fail=code=>{const e=Error(code);e.code=code;finish(e);};
    function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);}
    const abort=()=>{if(child)kill(child);fail('captcha_cancelled');};
    if(signal?.aborted)return fail('captcha_cancelled');
    try{child=spawnProcess(invocation.command,[...invocation.prefix,...args],{cwd,env:isolatedEnvironment(),windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});}
    catch{return fail('captcha_cli_spawn_failed');}
    timer=setTimeout(()=>{kill(child);fail('captcha_cli_timeout');},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    function line(value){try{onEvent(JSON.parse(value));}catch(error){if(error?.code){kill(child);finish(error);}}}
    child.stdout.on('data',bytes=>{if(settled)return;const text=String(bytes);stdout=(stdout+text).slice(-65536);buffer+=text;
      if(buffer.length>1024*1024){kill(child);fail('captcha_cli_output_limit');return;}
      let n;while((n=buffer.indexOf('\n'))>=0){line(buffer.slice(0,n));buffer=buffer.slice(n+1);}});
    child.stderr.on('data',bytes=>{stderr=(stderr+String(bytes)).slice(-4096);});
    child.once('error',error=>{const e=Error(error.code==='ENOENT'?'captcha_cli_missing':'captcha_cli_spawn_failed');e.code=e.message;finish(e);});
    child.once('close',code=>{
      if(buffer.trim())line(buffer);if(settled)return;
      if(code!==0){const type=/not logged|unauthorized|authentication|401/i.test(stderr+stdout)?'captcha_cli_auth_failed':/usage.limit|quota|rate.limit|429/i.test(stderr+stdout)?'captcha_cli_usage_limit':'captcha_cli_failed';return fail(type);}
      finish(null,{stdout,exitCode:code});
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
module.exports={resolveCodex,isolatedEnvironment,runCodex};

const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const DEFAULT_LOCK=path.join(os.tmpdir(),'unicorn-hh-dolphin-3001.lock.json');
function acquireLease(runDir,file=DEFAULT_LOCK) {
  const claim={pid:process.pid,host:os.hostname(),runDir,nonce:randomUUID(),createdAt:new Date().toISOString()};
  try{fs.writeFileSync(file,JSON.stringify(claim,null,2),{flag:'wx'});}catch{throw Error('hh_runner_locked_recovery_required');}
  return {claim,file,release(){
    const actual=JSON.parse(fs.readFileSync(file,'utf8'));
    if(actual.nonce!==claim.nonce)throw Error('hh_runner_lock_owner_changed');
    fs.unlinkSync(file);
  }};
}
function otherHhProcesses(exceptPid=process.pid){
  if(process.platform!=='win32')return [];
  const pattern=String.raw`(hh-run-[^ ]*[\\/]controller\.cjs|supervised[\\/](cli|worker)\.cjs|[\\/]cli[\\/]orchestrator\.ts)`;
  const text=require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ProcessId -ne ${Number(exceptPid)} -and $_.CommandLine -match '${pattern}' } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  const data=text?JSON.parse(text):[];return Array.isArray(data)?data:[data];
}
module.exports={acquireLease,otherHhProcesses,DEFAULT_LOCK};

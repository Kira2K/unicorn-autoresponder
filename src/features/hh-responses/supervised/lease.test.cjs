const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const {acquireLease,otherHhProcesses}=require('./lease.cjs');
test('a second checkout cannot replace a live or stale owner lease',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hh-lease-test-')),file=path.join(dir,'owner.json');
 try{
  const lease=acquireLease('fixture-run',file);assert.throws(()=>acquireLease('second',file),/recovery_required/);
  lease.release();assert.equal(fs.existsSync(file),false);
  fs.writeFileSync(file,JSON.stringify({pid:999999}));assert.throws(()=>acquireLease('third',file),/recovery_required/);
 }finally{assert.ok(dir.startsWith(path.join(os.tmpdir(),'hh-lease-test-')));fs.rmSync(dir,{recursive:true,force:true});}
});
test('Windows process preflight detects a supervisor in another checkout', {skip:process.platform!=='win32'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hh-process-test-')),script=path.join(dir,'supervised/cli.cjs');fs.mkdirSync(path.dirname(script));fs.writeFileSync(script,'setInterval(()=>{},1000)');
 const child=spawn(process.execPath,[script],{stdio:'ignore',windowsHide:true});
 try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});assert.ok(otherHhProcesses().includes(child.pid));}
 finally{child.kill();await new Promise(resolve=>child.once('close',resolve));assert.ok(dir.startsWith(path.join(os.tmpdir(),'hh-process-test-')));fs.rmSync(dir,{recursive:true,force:true});}
});

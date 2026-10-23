const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
// Windows can briefly hold a journal open for scanning. Never discard the old
// receipt, and retry only the local atomic rename, never a Telegram operation.
function saveAtomic(file,value,{io=fs,pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 io.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.'+randomUUID()+'.tmp';
 io.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});
 try{for(let attempt=0;;attempt++){
  try{io.renameSync(temp,file);return;}
  catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=19)throw e;pause(50);}
 }}finally{try{io.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
module.exports={saveAtomic};

const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
function createArtifacts(root,runId) {
  if(!/^hh-supervised-[a-zA-Z0-9-]+$/.test(runId))throw Error('captcha_artifact_scope_invalid');
  const dir=path.join(root,'tmp/captcha',runId),files=new Set();fs.mkdirSync(dir,{recursive:true});
  return {dir,save(image,attempt,profileId){
    if(!/^[a-f0-9]{64}$/.test(image.id)||!Number.isSafeInteger(profileId)||profileId<1)throw Error('captcha_identity_invalid');
    const file=path.join(dir,`${profileId}-${attempt}-${randomUUID()}.png`);fs.writeFileSync(file,image.bytes,{flag:'wx'});files.add(file);return file;
  },erase(file){if(!files.has(file))throw Error('captcha_artifact_not_owned');fs.rmSync(file,{force:true});files.delete(file);},close(){
    for(const file of files)fs.rmSync(file,{force:true});files.clear();if(fs.existsSync(dir))fs.rmdirSync(dir);
  }};
}
module.exports={createArtifacts};

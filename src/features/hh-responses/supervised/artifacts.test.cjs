const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createArtifacts}=require('./artifacts.cjs');
test('artifact ownership prevents foreign deletion and cleanup is safe to repeat',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hh-artifact-test-'));
 try{
  const store=createArtifacts(root,'hh-supervised-fixture');const file=store.save({id:'a'.repeat(64),bytes:Buffer.from('fixture')},1,12);
  assert.equal(path.dirname(file),path.join(root,'tmp/captcha/hh-supervised-fixture'));assert.throws(()=>store.erase(path.join(root,'foreign.png')),/not_owned/);
  store.erase(file);store.close();store.close();assert.equal(fs.existsSync(store.dir),false);
 }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'hh-artifact-test-')));fs.rmSync(root,{recursive:true,force:true});}
});

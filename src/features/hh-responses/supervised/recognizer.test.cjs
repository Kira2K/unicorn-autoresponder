const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRecognizer}=require('./recognizer.cjs');
function fixture(run){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hh-recognizer-test-'));
  const config={root,executable:null,model:'gpt-6.1-sol',reasoning:'high',recognitionTimeoutMs:1000};
  const recognizer=createRecognizer(config,{resolve:()=>({command:'fixture',prefix:[]}),run});
  return {root,recognizer,clean(){assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'hh-recognizer-test-'));fs.rmSync(root,{recursive:true,force:true});},assertEmpty(){assert.deepEqual(fs.readdirSync(path.join(root,'tmp/captcha')),[]);}};
}
const png=async()=>require('sharp')({create:{width:50,height:50,channels:3,background:'white'}}).png().toBuffer();
test('image-only inference returns structured words and usage, removes images, excludes project history',async()=>{
 let usage;const f=fixture(async(_inv,args,options)=>{
  assert.ok(args.includes('--ephemeral'));assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('project_doc_max_bytes=0'));assert.equal(args[args.indexOf('--model')+1],'gpt-6.1-sol');
  assert.equal(path.dirname(options.cwd),path.join(f.root,'tmp/captcha'));assert.equal(fs.existsSync(args[args.indexOf('--image')+1]),true);
  options.onEvent({type:'item.completed',item:{type:'agent_message',text:'{"text":"odd words"}'}});
  options.onEvent({type:'turn.completed',usage:{input_tokens:7000,output_tokens:17,cached_input_tokens:0}});
 });
 try{assert.equal(await f.recognizer.recognize(await png(),{},u=>usage=u),'odd words');assert.equal(usage.input_tokens,7000);f.assertEmpty();}finally{f.clean();}
});
test('missing usage cannot become zero-cost success and a failure always erases images',async()=>{
 let usage='not called';const f=fixture(async(_i,_a,o)=>o.onEvent({type:'item.completed',item:{type:'agent_message',text:'{"text":"odd words"}'}}));
 try{await assert.rejects(f.recognizer.recognize(await png(),{},u=>usage=u),/usage_unavailable/);assert.equal(usage,null);f.assertEmpty();}finally{f.clean();}
});
test('attempted tool use and a failed accounting callback preserve image cleanup',async()=>{
 const f=fixture(async(_i,_a,o)=>o.onEvent({type:'item.started',item:{type:'command_execution'}}));
 try{await assert.rejects(f.recognizer.recognize(await png()),/tool_use/);f.assertEmpty();
  await assert.rejects(f.recognizer.recognize(await png(),{},()=>{throw Error('accounting_failed')}),/accounting_failed/);f.assertEmpty();
 }finally{f.clean();}
});

const fs=require('node:fs/promises'),path=require('node:path');
const {resolveCodex,runCodex}=require('./codex-process.cjs');
function createRecognizer(config,{run=runCodex,resolve=resolveCodex,image=require('sharp')}={}) {
  const invocation=resolve(config.executable);
  return {
    async inspect(){
      const version=await run(invocation,['--version'],{cwd:config.root,timeoutMs:10000});
      await run(invocation,['login','status'],{cwd:config.root,timeoutMs:10000});
      return {version:version.stdout.trim(),model:config.model,reasoning:config.reasoning};
    },
    async recognize(bytes,{signal,timeoutMs=config.recognitionTimeoutMs}={},onUsage=()=>{}){
      const base=config.recognitionRoot??path.join(config.root,'tmp/captcha');await fs.mkdir(base,{recursive:true});
      const dir=await fs.mkdtemp(path.join(base,'recognizer-'));let usage=null,answer,toolUsed=false;
      try{
        if(bytes.length>2*1024*1024)throw Error('captcha_image_payload_invalid');
        const file=path.join(dir,'image.png');await image(bytes,{limitInputPixels:4000000}).resize({width:1200,kernel:'lanczos3'}).png().toFile(file);
        const args=['exec','--ignore-user-config','--model',config.model,'-c',`model_reasoning_effort=${JSON.stringify(config.reasoning)}`,'--ephemeral','--skip-git-repo-check','--sandbox','read-only','--cd',dir,'--json','--output-schema',path.join(__dirname,'recognition-schema.json')];
        for(const flag of ['shell_tool','view_image','apps','plugins','multi_agent','browser_use','computer_use','image_generation','in_app_browser'])args.push('--disable',flag);
        args.push('-c',`model_instructions_file=${JSON.stringify(path.join(__dirname,'recognition-instructions.md').replace(/\\/g,'/'))}`,'-c','web_search="disabled"','-c','project_doc_max_bytes=0','--image',file,'-');
        await run(invocation,args,{cwd:dir,signal,timeoutMs:Math.min(timeoutMs,config.recognitionTimeoutMs),input:'Transcribe the two English words in this authorized text CAPTCHA. Return only the required JSON object. Do not use tools.',onEvent:e=>{
          if(e.type==='turn.completed')usage=e.usage;
          if(e.type==='item.completed'&&e.item?.type==='agent_message'){try{answer=JSON.parse(e.item.text).text;}catch{}}
          if(e.item&&/command_execution|mcp_tool_call|web_search|file_change/.test(e.item.type)){toolUsed=true;const error=Error('captcha_cli_tool_use');error.code=error.message;throw error;}
        }});
        if(toolUsed)throw Error('captcha_cli_tool_use');
        if(!usage||!['input_tokens','output_tokens'].every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0))throw Error('captcha_usage_unavailable');
        if(typeof answer!=='string'||answer.length>100||/[\r\n\0]/.test(answer))throw Error('captcha_invalid_answer');
        return answer.trim();
      }finally{try{onUsage(usage);}finally{await fs.rm(dir,{recursive:true,force:true});}}
    },
    async selfTest(signal){
      // Synthetic text fixture: no student profile or HH request is involved.
      const bytes=await image(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="white"/><text x="20" y="80" font-size="52" font-family="Arial" fill="black">harbor violet</text></svg>')).png().toBuffer();
      let usage;const answer=await this.recognize(bytes,{signal},u=>{usage=u;});
      if(answer.toLowerCase()!=='harbor violet')throw Error('captcha_service_self_test_failed');
      return {accepted:true,usage};
    }
  };
}
module.exports={createRecognizer};

const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {REPO,report}=require('./live.cjs');
const LOCAL_FOLDER='C:/Users/kiras/TelegramArchives/VEU/runtime/local-extra-account';
const SUPPORT_FOLDER='C:/Users/kiras/TelegramArchives/VEU/runtime/support-account';
async function secret(label){const pipe='veu-extra-'+crypto.randomBytes(16).toString('hex');return await new Promise((resolve,reject)=>{
 let timer,child;const server=net.createServer(socket=>{let data='';socket.setEncoding('utf8');socket.on('data',chunk=>{data+=chunk;if(data.length>4096)socket.destroy(Error('input_too_long'));});socket.on('error',reject);socket.on('end',()=>{clearTimeout(timer);server.close();data?resolve(data):reject(Error('local_auth_cancelled'));});});
 server.on('error',reject);server.listen('\\\\.\\pipe\\'+pipe,()=>{const script=path.join(__dirname,'local-auth-prompt.ps1').replace(/'/g,"''");const command="& ([scriptblock]::Create([IO.File]::ReadAllText('"+script+"'))) -PipeName '"+pipe+"' -Label '"+label.replace(/'/g,"''")+"'";child=spawn('powershell.exe',['-NoProfile','-STA','-Command',command],{windowsHide:false,stdio:'ignore'});child.on('error',reject);});
 timer=setTimeout(()=>{server.close();child?.kill();reject(Error('local_auth_prompt_timeout'));},600000);
 });}
async function main(folder=LOCAL_FOLDER){
 if(process.platform!=='win32')throw Error('local_windows_auth_only');
 if(![LOCAL_FOLDER,SUPPORT_FOLDER].includes(folder))throw Error('invalid_local_auth_folder');
 const input=JSON.parse(fs.readFileSync(path.join(folder,'auth-input.json'),'utf8'));
 const cfg=require(REPO+'/src/integrations/telegram/tools/responses-application/index.ts').getConfig();
 const {TelegramClient}=require('telegram'),{StringSession}=require('telegram/sessions'),{Logger,LogLevel}=require('telegram/extensions/Logger');
 const file=path.join(folder,'gram.session'),c=new TelegramClient(new StringSession(fs.existsSync(file)?fs.readFileSync(file,'utf8').trim():''),cfg.apiId,cfg.apiHash,{connectionRetries:1,requestRetries:3,floodSleepThreshold:0,baseLogger:new Logger(LogLevel.NONE)});
 let failures=0;
 try{await c.start({phoneNumber:async()=>input.phone,phoneCode:async()=>{report('local_code_prompt_open');return await secret('Enter the Telegram login code (local only)');},password:async()=>{report('local_password_prompt_open');return await secret('Enter the Telegram 2FA password (local only)');},onError:async e=>{report('local_auth_retry',{code:e.errorMessage||'auth_failed'});return ++failures>=3;}});
  const me=await c.getMe();if((input.expectedId&&String(me.id)!==input.expectedId)||me.username?.toLowerCase()!==input.username.toLowerCase()||me.bot)throw Error('local_account_identity_mismatch');
  fs.writeFileSync(file,c.session.save(),{mode:0o600});fs.writeFileSync(path.join(folder,'identity.json'),JSON.stringify({id:String(me.id),username:me.username,authorizedAt:new Date().toISOString()}),{mode:0o600});
  fs.unlinkSync(path.join(folder,'auth-input.json'));report('local_extra_authorized',{id:String(me.id),username:me.username});
 }finally{await c.disconnect();}
}
if(require.main===module)main(process.argv.includes('--support')?SUPPORT_FOLDER:LOCAL_FOLDER).catch(e=>{report('local_extra_auth_failed',{code:e.errorMessage||e.code||e.message});process.exitCode=1;});
module.exports={LOCAL_FOLDER,SUPPORT_FOLDER,secret};

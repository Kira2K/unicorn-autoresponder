import {lookup as dnsLookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {Agent,get} from 'node:https';
import {connect as connectTls} from 'node:tls';
import {SocksClient} from 'socks';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {OctoError} from './contracts.mts';
import type {ProxyInput} from './contracts.mts';
import type {ProxyConnectivityResult} from './manual-proxy-check.mts';
import {manualProxyUrl} from './manual-proxy-check.mts';

const target=new URL('https://api.ipify.org?format=json');
const excluded=new BlockList(),publicV6=new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
 ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
 ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const)excluded.addSubnet(network,prefix,'ipv4');
publicV6.addSubnet('2000::',3,'ipv6');
for(const [network,prefix] of [['2001:db8::',32],['2001::',32],['2002::',16]] as const)excluded.addSubnet(network,prefix,'ipv6');
function publicAddress(address:string){
 const family=isIP(address);return family===4?!excluded.check(address,'ipv4'):
  family===6&&publicV6.check(address,'ipv6')&&!excluded.check(address,'ipv6');
}
interface ProbeOptions{input:ProxyInput;address:string;family:number;signal:AbortSignal;timeoutMs:number}
async function httpsProbe({input,address,signal,timeoutMs}:ProbeOptions):Promise<{status:number;body:string}>{
 let agent:Agent;
 if(input.type==='http'||input.type==='https'){
  const proxy=new URL(manualProxyUrl(input));proxy.hostname=isIP(address)===6?`[${address}]`:address;
  agent=new HttpsProxyAgent(proxy,{servername:input.host});
 }else{
  agent=new Agent({keepAlive:false});
  agent.createConnection=(_options,callback)=>{
   void SocksClient.createConnection({command:'connect',timeout:timeoutMs,
    proxy:{host:address,port:input.port,type:input.type==='socks4'?4:5,userId:input.login,password:input.password},
    destination:{host:target.hostname,port:443}}).then(({socket})=>{
     if(signal.aborted){socket.destroy();callback?.(new Error('check_aborted'),socket);return;}
     callback?.(null,connectTls({socket,servername:target.hostname,rejectUnauthorized:true}));
    },error=>callback?.(error,undefined!));
   return undefined;
  };
 }
 try{return await new Promise((resolve,reject)=>{
  const request=get(target,{agent,signal,headers:{Accept:'application/json'}},response=>{
   let body='';response.setEncoding('utf8');response.on('error',reject);
   response.on('data',chunk=>{body+=chunk;if(body.length>2048)request.destroy(new Error('check_response_too_large'));});
   response.on('end',()=>resolve({status:response.statusCode??0,body}));
  });request.on('error',reject);
 });}finally{agent.destroy();}
}
/** One bounded HTTPS request through the supplied proxy. No score, geography or provider selection. */
export function createProxyConnectivityCheck(options:{timeoutMs?:number;
 lookup?:(host:string)=>Promise<Array<{address:string;family:number}>>;
 probe?:(options:ProbeOptions)=>Promise<{status:number;body:string}>}={}){
 return async(input:ProxyInput):Promise<ProxyConnectivityResult>=>{
  const timeoutMs=options.timeoutMs??10_000,controller=new AbortController();
  let rejectDeadline!:(error:Error)=>void;
  const deadline=new Promise<never>((_resolve,reject)=>{rejectDeadline=reject;});
  const timer=setTimeout(()=>{controller.abort();rejectDeadline(new Error('check_timeout'));},timeoutMs);
  try{return await Promise.race([deadline,(async()=>{
   const host=input.host.replace(/^\[|\]$/g,''),literal=isIP(host);
   const addresses=literal?[{address:host,family:literal}]:await (options.lookup??(host=>dnsLookup(host,{all:true})))(host);
   if(controller.signal.aborted||!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw Error('invalid_proxy_address');
   const response=await (options.probe??httpsProbe)({input,address:addresses[0].address,family:addresses[0].family,signal:controller.signal,timeoutMs});
   if(response.status!==200||response.body.length>2048)throw Error('proxy_response_failed');
   const result=JSON.parse(response.body);if(!isIP(result?.ip))throw Error('invalid_exit_ip');
   return{ok:true,exit_ip:result.ip};
  })()]);}catch{throw new OctoError('octo_proxy_check_failed',422);}finally{clearTimeout(timer);controller.abort();}
 };
}

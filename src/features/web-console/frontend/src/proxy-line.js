const fail=reason=>{throw new Error(`proxy_line_${reason}`)}

/** Parse locally into existing form fields. No network, persistence or hostname substitution. */
export function parseProxyLine(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.length>4096||/[\r\n]/.test(raw))fail('format')
 const type='socks5'
 let host,port,login='',password=''
 if(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trimStart())){
  let url
  try{url=new URL(raw.trim())}catch{fail('format')}
  if(!['socks5:','socks5h:'].includes(url.protocol))fail('protocol')
  if(url.pathname&&url.pathname!=='/'||url.search||url.hash)fail('format')
  host=url.hostname
  port=Number(url.port)
  try{login=decodeURIComponent(url.username);password=decodeURIComponent(url.password)}catch{fail('encoding')}
 }else{
  const match=/^(\[[^\]]+\]|[^:]+):([^:]+)(?::([^:]*):(.*))?$/.exec(raw)
  if(!match)fail('format')
  host=match[1].trim()
  if(!/^\d+$/.test(match[2].trim()))fail('port')
  port=Number(match[2].trim());login=match[3]??'';password=match[4]??''
 }
 if(!host||host.length<4||host.length>253||/[\s/@?#]/.test(host))fail('host')
 if(!Number.isInteger(port)||port<1||port>65535)fail('port')
 if(login.length>255||password.length>255||/[\r\n]/.test(login+password))fail('format')
 return{type,host,port,login,password}
}

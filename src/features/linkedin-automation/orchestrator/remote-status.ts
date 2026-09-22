// Read-only diagnostic entry point. No application startup, writer or browser session is imported.
import 'dotenv/config'
const args=process.argv.slice(2)
async function main(){
  const base=process.env.LINKEDIN_DIAGNOSTICS_URL,token=process.env.LINKEDIN_DIAGNOSTICS_TOKEN
  if(!base||!token)throw Error('diagnostics_access_not_configured')
  const url=new URL('/api/admin/linkedin/automation/diagnostics',base)
  if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('diagnostics_https_required')
  for(const key of ['account','runKey','before']) {const value=args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3);if(value)url.searchParams.set(key,value)}
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'})
  if(!response.ok)throw Error(`diagnostics_http_${response.status}`)
  const body=await response.json();console.log(JSON.stringify(body,null,2))
}
void main().catch(error=>{const safe=/^diagnostics_[a-z0-9_]+$/.test(error.message)?error.message:'diagnostics_server_unreachable';
  console.error(safe);process.exitCode=1})

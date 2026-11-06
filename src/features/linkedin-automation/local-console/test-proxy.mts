import {parseProxyInput} from '../../octo-access/proxy-input.mts';
import {manualProxyFingerprint} from '../../octo-access/manual-proxy-check.mts';
const parse=(row:any)=>parseProxyInput({...row,type:row.type==='socks'?'socks4':row.type,changeIpUrl:row.change_ip_url});
/** A free UUID is insufficient: another saved proxy can already use the same credentials. */
export function unusedTestProxy(rows:any[],uuid:string,reserved:ReadonlySet<string>=new Set(),pending:ReadonlySet<string>=new Set()) {
  const row=rows.find(p=>p.uuid===uuid);
  if(!row||row.profiles_count!==0||!/test|тест|e2e|demo|демо/i.test(row.title)||reserved.has(uuid))throw Error('e2e_unused_test_proxy_required');
  const input=parse(row),fingerprint=manualProxyFingerprint(input);
  if(pending.has(fingerprint))throw Error('e2e_test_connection_reserved');
  for(const other of rows.filter(p=>p.profiles_count>0)){
    let connected;try{connected=parse(other);}catch{continue;}
    if(manualProxyFingerprint(connected)===fingerprint)throw Error('e2e_test_connection_in_use');
  }
  return input;
}

// Different local Desktop instances may serve owner and guest. Never expose a remote origin.
export function createBridgeLocalFetch(port, fetchImpl = fetch) {
 if(!Number.isInteger(port)||port<1024||port>65535)throw Object.assign(Error('bridge_invalid_local_port'),{code:'bridge_invalid_local_port'});
 return async (input,init) => {
  const url=new URL(String(input));
  if(url.origin==='http://127.0.0.1:58888'){
   if(!['/api/username','/api/profiles/active','/api/profiles/password'].includes(url.pathname))
    throw Object.assign(Error('bridge_invalid_local_endpoint'),{code:'bridge_invalid_local_endpoint'});
   url.port=String(port);return fetchImpl(url.toString(),init);
  }
  return fetchImpl(input,init);
 };
}

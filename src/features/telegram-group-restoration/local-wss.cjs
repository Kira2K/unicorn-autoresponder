require('telegram');
const {ConnectionTCPObfuscated}=require('telegram/network/connection'),{PromisedWebSockets}=require('telegram/extensions');
function useLocalWss(client){
 const getDC=client.getDC.bind(client);
 client.getDC=(dcId,download=false)=>getDC(dcId,download,true);
 const connect=client.connect.bind(client);
 client.connect=async()=>{client.useWSS=true;client._connection=ConnectionTCPObfuscated;client.networkSocket=PromisedWebSockets;const dc=await client.getDC(client.session.dcId,false,true);client.session.setDC(client.session.dcId,dc.ipAddress,443);return await connect();};
 return client;
}
module.exports={useLocalWss};

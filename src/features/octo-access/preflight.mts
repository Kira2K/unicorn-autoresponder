// Read-only operator check. Does not expose credentials or touch the desktop API.
import {createCloudApi} from './cloud-api.mts';
const api=createCloudApi(process.env.OCTO_API_TOKEN??'');
try {
  const folders=await api.listFolders(),proxies=await api.listProxies();
  const guest=process.env.OCTO_GUEST_FOLDER_UUID??'1021acd2bce540eca8a38fe664e7ff64';
  const home=process.env.OCTO_HOME_FOLDER_UUID??'0527f84353274cc0ac18db2331c7f2c4';
  await api.validateGuest(process.env.OCTO_GUEST_EMAIL??'kind.cute.unicorn@gmail.com',guest);
  console.log(JSON.stringify({tokenAccepted:true,guestPasswordConfigured:!!process.env.OCTO_GUEST_PASSWORD,
    guestRightsValid:true,foldersPresent:[guest,home].every(id=>folders.some(f=>f.uuid===id)),
    unusedReadyProxies:proxies.filter(p=>p.profiles_count===0&&/^Ready\s*\d+/i.test(p.title)).length}));
}catch(error){console.error(JSON.stringify({error:(error as any)?.code??'octo_preflight_failed',details:(error as any)?.details}));process.exitCode=1;}

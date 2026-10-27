import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { blockedFields, readBlockedAccounts } from '../console-intake/contracts.mts';
import type { BlockedAccount } from '../console-intake/contracts.mts';

/** Read-only expert view: submitted cards plus previously archived accounts owned by this student. */
export async function loadBlockedHistory(sql:Pick<SqlSession,'query'>,clientId:number,currentAccountId:number,currentHistory:unknown):Promise<BlockedAccount[]> {
  const archived=(await sql.query(`SELECT a.id,a.url,a.login,a.linkedin_first_name,a.linkedin_last_name,
    a.real_location,a.old_link_blocked,coalesce(a.password,'')<>'' AS has_password
    FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
    WHERE a.clients_id=$1 AND a.id<>$2 AND coalesce(a.__nc_deleted,false)
      AND lower(p.name)='linkedin' ORDER BY a.id`,[clientId,currentAccountId])).rows;
  const result:BlockedAccount[]=[],seen=new Set<string>();
  const appendEntered=(value:unknown)=>{
    for(const card of readBlockedAccounts(value)){
      // Copied history has the same meaning regardless of JSON property order.
      const key=JSON.stringify(blockedFields.map(field=>card[field]??''));
      if(!seen.has(key)){seen.add(key);result.push(card);}
    }
  };
  appendEntered(currentHistory);
  for(const account of archived){
    appendEntered(account.old_link_blocked);
    if(!account.url&&!account.login&&!account.has_password)continue;
    const fullName=[account.linkedin_first_name,account.linkedin_last_name].filter(Boolean).join(' ');
    const notes=[['Ссылка LinkedIn',account.url],['Логин LinkedIn',account.login],['Локация',account.real_location]]
      .filter(([,value])=>value).map(([label,value])=>`${label}: ${value}`);
    result.push({...(fullName?{fullName}:{}),legacyText:[`Архивный LinkedIn №${account.id}`,...notes].join('\n')});
  }
  return result;
}

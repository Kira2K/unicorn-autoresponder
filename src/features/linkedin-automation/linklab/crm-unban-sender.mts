import {sendAccountCommand} from './crm-account-command.mts';
import type {readAccountCommandConfig} from './crm-account-actions.mts';

/** Caller owns the committed source operation and retains these exact bytes/IDs.
 * No SQL, ID allocation, source transition or automatic retry belongs to this adapter.
 */
export function createUnbanSender(options:{
  config?:NonNullable<ReturnType<typeof readAccountCommandConfig>>;
  fetch?:typeof globalThis.fetch;
}) {
  if(!options.config)return undefined;
  const config={...options.config,fetch:options.fetch};
  return async function sendCommittedUnban(input:{body:Buffer;expectedStudentId:string}) {
    if(!Buffer.isBuffer(input.body)||input.body.length===0||input.body.length>8192)
      throw Error('crm_account_command_payload_invalid');
    const body=Buffer.from(input.body);
    let command:unknown;
    try{command=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))?.command;}
    catch{throw Error('crm_account_command_payload_invalid');}
    if(command!=='unban')throw Error('crm_account_command_payload_invalid');
    return sendAccountCommand({body,expectedStudentId:input.expectedStudentId},config);
  };
}

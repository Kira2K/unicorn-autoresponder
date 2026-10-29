import type { WebClient } from '../../web-console/backend/types.ts';
import { profileRules } from '../../octo-access/profile-reservation.mts';
import { IntakeError, parseIntake, safeClientFields, completeBlockedAccount, sameBlockedAccount } from './contracts.mts';
import type { createLinkedInIntakeStore } from './postgres-store.mts';
import type {CommandDelivery} from '../linklab/crm-account-actions.mts';

export function createLinkedInIntakeService(deps: {
  store: Pick<ReturnType<typeof createLinkedInIntakeStore>, 'load' | 'save'> & Partial<Pick<ReturnType<typeof createLinkedInIntakeStore>,'reportBan'>>;
  allowed(id: number): boolean;
  getClient(id: number): Promise<WebClient>;
  hasDolphin(id: number): Promise<boolean>;
  reportCrmBan?(clientId: number, accountId: number): Promise<CommandDelivery>;
}) {
  return {
    async reportBan(id:number,raw:unknown){
      await deps.getClient(id);
      const accountId=(raw as {linkedinAccountId?:unknown})?.linkedinAccountId;
      if(typeof accountId!=='number'||!Number.isSafeInteger(accountId)||accountId<1)throw new IntakeError('linkedin_intake_replacement_invalid');
      if(!deps.store.reportBan)throw new IntakeError('linkedin_intake_ban_unavailable',503);
      const result=await deps.store.reportBan(id,accountId);
      const {banChanged,...saved}=result;
      if(!banChanged||!deps.reportCrmBan)return saved;
      let crm:CommandDelivery;
      try{crm=await deps.reportCrmBan(id,accountId);}catch{crm={state:'uncertain',code:'crm_account_command_unconfirmed'};}
      return {...saved,crm};
    },
    async load(id: number) { const client=await deps.getClient(id),data=await deps.store.load(id);return{...data,realLocation:data.realLocation||client.realLocation||''}; },
    async save(id: number, raw: unknown) {
      const data = parseIntake(raw), replacement=data.replacesLinkedInAccountId!==undefined;
      if(!deps.allowed(id))throw new IntakeError('forbidden',403);
      const c=await deps.getClient(id),dolphin=await deps.hasDolphin(id);
      const dolphinTask=dolphin&&!replacement&&data.scenario==='new'?await deps.store.load(id):undefined;
      if(dolphin&&!replacement&&!dolphinTask?.task)throw new IntakeError('linkedin_intake_use_dolphin',409);
      if(data.scenario==='new'){
        const issues=profileRules.getRequiredClientDataIssues(c,{requireCalendarEmail:true}) as Array<{field:string}>;
        if(issues.length)throw Object.assign(new IntakeError('octo_client_data_required',409),{fields:safeClientFields(issues.map(issue=>issue.field))});
      }
      const locales=profileRules.requiredLocalesForMarket(c.market);
      const recovery=replacement || (data.scenario==='new'&&(dolphin||!locales.includes('en'))&&!!(dolphinTask??await deps.store.load(id)).task);
      if(!recovery){
        if(dolphin)throw new IntakeError('linkedin_intake_use_dolphin',409);
        if(!locales.includes('en'))throw new IntakeError('forbidden',403);
      }
      if (data.scenario === 'new' && !data.outlookRegisteredAt)
        throw new IntakeError('linkedin_intake_outlook_registration_required');
      const incomplete=data.blockedAccounts.filter(card=>!completeBlockedAccount(card));
      if(incomplete.length){
        const previous=dolphinTask??await deps.store.load(id),unchanged=[...(previous.editableBlockedAccounts??previous.blockedAccounts)];
        for(const card of incomplete){
          const index=unchanged.findIndex(saved=>sameBlockedAccount(card,saved));
          if(index<0)throw new IntakeError('linkedin_intake_blocked_required');
          unchanged.splice(index,1);
        }
      }
      return deps.store.save(id, data, recovery?[...new Set([...locales,'en'])]:locales, { createOctoProfiles: true });
    }
  };
}
export type LinkedInIntakeService = ReturnType<typeof createLinkedInIntakeService>;

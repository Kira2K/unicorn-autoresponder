import type { WebClient } from '../../web-console/backend/types.ts';
import { profileRules } from '../../octo-access/profile-reservation.mts';
import { IntakeError, parseIntake } from './contracts.mts';
import type { createLinkedInIntakeStore } from './postgres-store.mts';

export function createLinkedInIntakeService(deps: {
  store: Pick<ReturnType<typeof createLinkedInIntakeStore>, 'load' | 'save'>;
  allowed(id: number): boolean;
  getClient(id: number): Promise<WebClient>;
  hasDolphin(id: number): Promise<boolean>;
}) {
  return {
    async load(id: number) { await deps.getClient(id); return deps.store.load(id); },
    async save(id: number, raw: unknown) {
      const data = parseIntake(raw), replacement=data.replacesLinkedInAccountId!==undefined;
      if(!deps.allowed(id))throw new IntakeError('forbidden',403);
      const c=await deps.getClient(id),dolphin=await deps.hasDolphin(id);
      const locales=profileRules.requiredLocalesForMarket(c.market);
      const recovery=replacement || (data.scenario==='new'&&(dolphin||!locales.includes('en'))&&!!(await deps.store.load(id)).task);
      if(!recovery){
        if(dolphin)throw new IntakeError('linkedin_intake_use_dolphin',409);
        if(!locales.includes('en'))throw new IntakeError('forbidden',403);
      }
      if (data.scenario === 'new' && !data.outlookRegisteredAt)
        throw new IntakeError('linkedin_intake_outlook_registration_required');
      if (data.scenario === 'new' && profileRules.getRequiredClientDataIssues(c, { requireCalendarEmail: true }).length)
        throw new IntakeError('octo_client_data_required', 409);
      return deps.store.save(id, data, recovery?[...new Set([...locales,'en'])]:locales, { createOctoProfiles: true });
    }
  };
}
export type LinkedInIntakeService = ReturnType<typeof createLinkedInIntakeService>;

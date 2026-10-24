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
  async function client(id: number) {
    if (!deps.allowed(id)) throw new IntakeError('forbidden', 403);
    const value = await deps.getClient(id);
    if (!profileRules.requiredLocalesForMarket(value.market).includes('en')) throw new IntakeError('forbidden', 403);
    return value;
  }
  return {
    async load(id: number) { await client(id); return deps.store.load(id); },
    async save(id: number, raw: unknown) {
      const c = await client(id), data = parseIntake(raw);
      const hasDolphin = await deps.hasDolphin(id);
      if (hasDolphin && data.scenario === 'existing') throw new IntakeError('linkedin_intake_use_dolphin', 409);
      if (data.scenario === 'new' && !hasDolphin && profileRules.getRequiredClientDataIssues(c, { requireCalendarEmail: true }).length)
        throw new IntakeError('octo_client_data_required', 409);
      return deps.store.save(id, data, profileRules.requiredLocalesForMarket(c.market), { createOctoProfiles: !hasDolphin });
    }
  };
}
export type LinkedInIntakeService = ReturnType<typeof createLinkedInIntakeService>;

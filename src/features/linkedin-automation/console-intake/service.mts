import type { WebClient } from '../../web-console/backend/types.ts';
import { profileRules } from '../../octo-access/profile-reservation.mts';
import { IntakeError, parseIntake, isManualTestIntakeUser } from './contracts.mts';
import type { createLinkedInIntakeStore } from './postgres-store.mts';

export function createLinkedInIntakeService(deps: {
  store: Pick<ReturnType<typeof createLinkedInIntakeStore>, 'load' | 'save'>;
  allowed(id: number): boolean;
  getClient(id: number): Promise<WebClient>;
  hasDolphin(id: number): Promise<boolean>;
}) {
  async function client(id: number) {
    if (!deps.allowed(id)) throw new IntakeError('forbidden', 403);
    if (await deps.hasDolphin(id)) throw new IntakeError('linkedin_intake_use_dolphin', 409);
    const value = await deps.getClient(id);
    if (!profileRules.requiredLocalesForMarket(value.market).includes('en')) throw new IntakeError('forbidden', 403);
    return value;
  }
  return {
    async load(id: number): ReturnType<typeof deps.store.load> {
      const c = await client(id), data = await deps.store.load(id);
      if (isManualTestIntakeUser(c.calendarEmail)) return data;
      const { outlookRegisteredAt: _pilotTimestamp, ...legacy } = data;
      return legacy;
    },
    async save(id: number, raw: unknown) {
      const c = await client(id);
      let payload = raw;
      if (!isManualTestIntakeUser(c.calendarEmail) && raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const { outlookRegisteredAt: _pilotTimestamp, ...legacy } = raw as Record<string, unknown>;
        payload = legacy;
      }
      const data = parseIntake(payload);
      if (data.scenario === 'new' && isManualTestIntakeUser(c.calendarEmail) && !data.outlookRegisteredAt)
        throw new IntakeError('linkedin_intake_outlook_registration_required');
      if (data.scenario === 'new' && profileRules.getRequiredClientDataIssues(c, { requireCalendarEmail: true }).length)
        throw new IntakeError('octo_client_data_required', 409);
      return deps.store.save(id, data, profileRules.requiredLocalesForMarket(c.market), { createOctoProfiles: true });
    }
  };
}
export type LinkedInIntakeService = ReturnType<typeof createLinkedInIntakeService>;

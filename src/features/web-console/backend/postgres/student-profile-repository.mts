import type { ClientDashboard, WebConsoleRepository } from '../types.ts';
import type { studentProfileStore } from './student-profile-store.mts';

export function withStudentProfile(base: WebConsoleRepository,
  store: Pick<ReturnType<typeof studentProfileStore>, 'load' | 'save'>, clientId: number): WebConsoleRepository {
  async function enrich(dashboard: ClientDashboard) {
    if (dashboard.client.id !== clientId) return dashboard;
    return { ...dashboard, client: { ...dashboard.client, ...await store.load(clientId), studentProfileEnabled: true as const } };
  }
  return { ...base,
    async getClientDashboard(id, options) { return enrich(await base.getClientDashboard(id, options)); },
    async createPlatformAccount(id, input) { return enrich(await base.createPlatformAccount(id, input)); },
    async updatePlatformAccount(id, accountId, input) { return enrich(await base.updatePlatformAccount(id, accountId, input)); },
    async deletePlatformAccount(id, accountId) { return enrich(await base.deletePlatformAccount(id, accountId)); },
    async updateClientProfile(id, input) {
      const { middleName, noHigherEducation, currentCompany, previousCompanies, ...existing } = input;
      const saved = await base.updateClientProfile(id, existing);
      if (id !== clientId) return saved;
      await store.save(id, input);
      return enrich(await base.getClientDashboard(id, { fullAccess: false }));
    }
  };
}

import type { ClientDashboard, WebConsoleRepository } from '../types.ts';
import type { studentProfileStore } from './student-profile-store.mts';
import { validateStudentEducation, educationText } from '../../student-education.ts';
import { profileToday } from '../../student-profile-validation.ts';

export function withStudentProfile(base: WebConsoleRepository,
  store: Pick<ReturnType<typeof studentProfileStore>, 'load' | 'save'>): WebConsoleRepository {
  async function enrich(dashboard: ClientDashboard) {
    return { ...dashboard, client: { ...dashboard.client, ...await store.load(dashboard.client.id), studentProfileEnabled: true as const } };
  }
  return { ...base,
    async getClientDashboard(id, options) { return enrich(await base.getClientDashboard(id, options)); },
    async createPlatformAccount(id, input) { return enrich(await base.createPlatformAccount(id, input)); },
    async updatePlatformAccount(id, accountId, input) { return enrich(await base.updatePlatformAccount(id, accountId, input)); },
    async deletePlatformAccount(id, accountId) { return enrich(await base.deletePlatformAccount(id, accountId)); },
    async updateClientProfile(id, input) {
      const { middleName, noHigherEducation, currentCompany, previousCompanies, ...existing } = input;
      let extensionPatch = input;
      if (noHigherEducation !== undefined || input.educationEntries !== undefined || input.education !== undefined) {
        const current = (await enrich(await base.getClientDashboard(id))).client;
        const mode = noHigherEducation === undefined ? current.noHigherEducation === true : noHigherEducation === true;
        const entries = input.educationEntries !== undefined ? input.educationEntries
          : input.education !== undefined ? [{ uni: input.education ?? '', faculty: '', grade: '', yearOfEnd: '' }]
          : current.educationEntries;
        const education = validateStudentEducation(entries, mode, Number(profileToday().slice(0, 4)));
        if (education.error) throw Object.assign(new Error(education.error), { code: 'invalid_student_education' });
        extensionPatch = { ...input, noHigherEducation: mode, educationEntries: education.value, education: educationText(education.value) };
        // Both education variants and the flag are written together by the SQL store.
        delete existing.education;
        delete existing.educationEntries;
      }
      await base.updateClientProfile(id, existing);
      await store.save(id, extensionPatch);
      return enrich(await base.getClientDashboard(id, { fullAccess: false }));
    }
  };
}

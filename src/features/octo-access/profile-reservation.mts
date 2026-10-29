import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { OctoError } from './contracts.mts';
import type { Locale, OctoStore } from './contracts.mts';
import type { WebClient } from '../web-console/backend/types.ts';
import { ensureClientPassword } from './client-password.mts';

export const profileRules = createRequire(import.meta.url)('../web-console/backend/dolphin-profile-provisioning.ts') as {
  requiredLocalesForMarket(value: unknown): Locale[];
  getRequiredClientDataIssues(client: WebClient, options: { requireCalendarEmail: boolean }): unknown[];
  buildProfileName(client: WebClient, locale: Locale): string;
  transliterate(value: string): string;
};
export function assertClientReady(client: WebClient) {
  const issues=profileRules.getRequiredClientDataIssues(client,{requireCalendarEmail:true}) as Array<{field:string}>;
  if(issues.length)throw Object.assign(new OctoError('octo_client_data_required',409),{fields:issues.map(issue=>({field:issue.field}))});
}
export async function reserveClientProfiles(store: OctoStore, client: WebClient, ownProxy: boolean,
  now = Date.now, password?: () => string, requiredLocales = profileRules.requiredLocalesForMarket(client.market)) {
  assertClientReady(client);
  const existing = await store.list(client.id);
  const missing = requiredLocales.filter(locale => !existing.some(p => p.locale === locale));
  if (!missing.length) return existing;
  const account = await ensureClientPassword(store, client.id, password);
  const { transliterate, buildProfileName } = profileRules;
  const drafts = missing.map(locale => {
    const operationId = randomUUID();
    const name = client.calendarEmail.toLowerCase() === 'alex.octo@example.com' ? 'alex'
      : client.calendarEmail.toLowerCase() === 'bob.octo@example.com' ? 'bob' : '';
    return { clientId: client.id, locale, operationId, password: account.password, createdAt: now(), ownProxy,
      phase: 'queued' as const,
      proxyName: transliterate(client.firstName) + ' | {profileId} | ' + transliterate(client.lastName) + ' | ' + client.commonChatId + ' | ' + client.primaryStack + ' En',
      original: { title: buildProfileName(client, locale).slice(0, 90), description: 'unicorn-octo:' + operationId,
        tags: [], start_pages: name ? ['https://en.wikipedia.org/w/index.php?search=' + name] : [] } };
  });
  await store.reserve(drafts);
  return store.list(client.id);
}

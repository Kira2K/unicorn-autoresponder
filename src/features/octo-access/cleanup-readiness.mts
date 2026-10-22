import { OctoError } from './contracts.mts';
import type { ManagedProfile, Metadata, OctoStore } from './contracts.mts';
export const sameMetadata = (p: Omit<Metadata, 'tags'> & { tags?: string[] }, m: Metadata) => p.title === m.title && p.description === m.description
  && JSON.stringify(p.tags ?? []) === JSON.stringify(m.tags) && JSON.stringify(p.start_pages) === JSON.stringify(m.start_pages);
// Shared by grant advancement and the bridge's one-shot authorization barrier.
export async function cleanupHistoryReady(p: ManagedProfile, store: OctoStore) {
  const g = p.grant!;
  if ((await store.stream()).coverageSince > g.createdAt) throw new OctoError('octo_event_history_gap');
  const events = (await store.events(p.uuid!, g.eventsAfter)).filter(e => e.time * 1000 >= Math.floor(g.createdAt / 1000) * 1000);
  if (events.some(e => e.action === 'profiles.force_stopped')) throw new OctoError('octo_force_stop_observed');
  const lifecycle = events.filter(e => ['profiles.started', 'profiles.stopped'].includes(e.action));
  const normallyClosed = lifecycle.some(e => e.action === 'profiles.started') && lifecycle.at(-1)?.action === 'profiles.stopped';
  const hideBarrier = events.some(e => e.action === 'profiles.updated' && e.title === g.original.title && e.time >= Math.floor(g.hiddenAt! / 1000));
  return hideBarrier && (normallyClosed || !lifecycle.length);
}

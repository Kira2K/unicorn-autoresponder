import { NAMES, TestError } from './contract.mts';
import type { Folder, ProfileName, State } from './contract.mts';

export const LEASE_MS = 45_000;
export const RECHECK_MS = 30_000;
export interface Fixtures { runId: string; folders: Record<'home' | 'guest', Folder>; profiles: Record<ProfileName, string> }
export interface TimedGrant {
  id: string; name: ProfileName; uuid: string; alias: string; anonymousDescription: string;
  original: { title: string; description: string; tags: string[]; start_pages: string[] };
  phase: 'preparing' | 'awaiting_start' | 'granted' | 'awaiting_close' | 'complete' | 'blocked';
  createdAt: number; grantedAt?: number; expiresAt?: number; nextCheckAt: number;
  pending?: 'protect' | 'mask' | 'publish' | 'hide' | 'clear';
  error?: string; lastTrigger?: 'event' | 'poll'; completedAt?: number;
  lastEvent?: { id: string; action: string; time: number };
  stoppedEventId?: string;
  startedEventId?: string;
  forceStopped?: boolean;
}
export interface TimedState {
  schema: 2; fixtureRunId: string; grants: Partial<Record<ProfileName, TimedGrant>>;
  cursor?: { uuid: string; time: number }; seenEvents: string[];
}
export interface TimedStore { load(): Promise<TimedState | null>; save(state: TimedState): Promise<void> }

export function fixturesFromState(state: State | null): Fixtures {
  if (!state || !state.folders.home || !state.folders.guest || !state.profiles.Alex || !state.profiles.Bob
    || state.profiles.Alex === state.profiles.Bob || state.folders.home.uuid === state.folders.guest.uuid) throw new TestError('existing_test_fixtures_required');
  return { runId: state.runId, folders: state.folders as Fixtures['folders'], profiles: state.profiles as Fixtures['profiles'] };
}

export function validateTimedState(value: any): TimedState {
  const finite = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!value || value.schema !== 2 || typeof value.fixtureRunId !== 'string' || !value.grants
    || !Array.isArray(value.seenEvents) || value.seenEvents.length > 500 || !value.seenEvents.every((id: unknown) => typeof id === 'string')) throw new TestError('invalid_timed_state', 500);
  if (value.cursor && (typeof value.cursor.uuid !== 'string' || !finite(value.cursor.time))) throw new TestError('invalid_timed_cursor', 500);
  for (const [name, grant] of Object.entries(value.grants) as [ProfileName, TimedGrant][]) {
    if (!NAMES.includes(name) || !grant || grant.name !== name || typeof grant.id !== 'string' || typeof grant.uuid !== 'string'
      || typeof grant.alias !== 'string' || typeof grant.anonymousDescription !== 'string'
      || !['preparing', 'awaiting_start', 'granted', 'awaiting_close', 'complete', 'blocked'].includes(grant.phase)
      || !finite(grant.createdAt) || !finite(grant.nextCheckAt) || !grant.original
      || typeof grant.original.title !== 'string' || typeof grant.original.description !== 'string'
      || !Array.isArray(grant.original.tags) || !grant.original.tags.every(v => typeof v === 'string')
      || !Array.isArray(grant.original.start_pages) || !grant.original.start_pages.every(v => typeof v === 'string')
      || (grant.pending !== undefined && !['protect', 'mask', 'publish', 'hide', 'clear'].includes(grant.pending))) throw new TestError('invalid_timed_grant', 500);
    if (!['preparing', 'awaiting_start', 'blocked'].includes(grant.phase) && (!finite(grant.grantedAt) || !finite(grant.expiresAt) || grant.expiresAt! - grant.grantedAt! !== LEASE_MS)) throw new TestError('invalid_timed_deadline', 500);
  }
  return value;
}

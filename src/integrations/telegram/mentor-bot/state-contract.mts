import type { State } from './types.mts';

/** Storage-independent invariants, checked before publishing or issuing writes. */
export function assertStateMutation(before: State, after: State): void {
  for (const [key, audit] of Object.entries(before.history)) {
    if (JSON.stringify(after.history[key]) !== JSON.stringify(audit)) throw new Error('mentor_history_immutable');
  }
  for (const table of ['learners','checkins','deliveries','operations'] as const) {
    for (const key of Object.keys(before[table])) {
      if (after[table][key] === undefined) throw new Error('mentor_history_delete_forbidden');
    }
  }
  const periods = new Set<string>();
  for (const checkin of Object.values(after.checkins)) {
    const key = JSON.stringify([checkin.clientId, checkin.end]);
    if (periods.has(key)) throw new Error('mentor_checkin_period_duplicate');
    periods.add(key);
    const result = checkin.result;
    if (result !== undefined && (!result || typeof result.recruiters !== 'boolean' ||
      typeof result.interviews !== 'boolean' || typeof result.actor !== 'string'))
      throw new Error('mentor_complete_result_required');
  }
}

import type { Client, Learner, State, Store } from './types.mts';
import { DAY, WEEK, nextThursday, mondayAfter } from './calendar.mts';
import { checkinDelivery, CHECKIN_STATUSES, EXCLUDED } from './policy.mts';
import { enqueue, report, HOME } from './messages.mts';

export function enroll(state: State, clientId: string, now: number): void {
  if (state.learners[clientId]) return;
  const c = state.clients[clientId];
  if (!c) throw new Error('client_missing');
  state.learners[clientId] = { clientId, enabledAt: now, status: c.status, version: 0,
    active: CHECKIN_STATUSES.has(c.status), recruiterMisses: 0, interviewMisses: 0,
    ...(CHECKIN_STATUSES.has(c.status) ? { activatedAt: now, nextOpenAt: nextThursday(now) } : {}) };
}
function startCheckins(l: Learner, at: number): void {
  l.activatedAt ??= at;
  l.active = true; l.nextOpenAt = nextThursday(at);
}
function stopCheckins(state: State, l: Learner): void {
    l.active = false;
    delete l.nextOpenAt;
    for (const d of Object.values(state.deliveries)) {
      if (d.clientId === l.clientId && ['pending','sending'].includes(d.state) &&
          (checkinDelivery(d,state.sessions) || (EXCLUDED.has(l.status) &&
            (d.kind === 'report' || d.kind === 'reminder')))) d.state = 'cancelled';
    }
    for (const ch of Object.values(state.checkins)) {
      if (ch.clientId === l.clientId && ch.state === 'open') {
        ch.state = ch.result ? 'closed' : 'cancelled';
        ch.version++;
      }
    }
    for (const [id,s] of Object.entries(state.sessions)) if (s.clientId === l.clientId && s.action === 'checkin') delete state.sessions[id];
}
export function changeStatus(state: State, l: Learner, status: string, at: number): void {
  if (l.status === status) return;
  l.status = status;
  l.version++;
  if (!CHECKIN_STATUSES.has(status)) stopCheckins(state,l);
  else if (!l.active) startCheckins(l,at);
}
function advance(state: State, l: Learner, until: number, inclusive: boolean): string | undefined {
  let lastMiss: string | undefined;
  while (l.active && l.nextOpenAt !== undefined && (inclusive ? l.nextOpenAt <= until : l.nextOpenAt < until)) {
    const boundary = l.nextOpenAt;
    for (const ch of Object.values(state.checkins)) {
      if (ch.clientId !== l.clientId || ch.state !== 'open' || ch.closesAt > boundary) continue;
      ch.state = 'closed'; ch.version++;
      if (!ch.result) { l.recruiterMisses++; l.interviewMisses++; lastMiss = ch.id; }
      for (const [id,s] of Object.entries(state.sessions)) if (s.checkinId === ch.id) delete state.sessions[id];
    }
    const id = l.clientId + ':' + boundary;
    state.checkins[id] ??= { id, clientId: l.clientId, start: boundary - WEEK, end: boundary,
      closesAt: boundary + WEEK, state: 'open', version: 0 };
    l.nextOpenAt = boundary + WEEK;
  }
  return lastMiss;
}
export type StatusDiagnostic = { event: 'mentor_status_sync'; clientId: string;
  code: 'mentor_status_history_required' | 'mentor_status_history_recovered' };
export function reconcile(state: State, now: number, reportChatId: string): StatusDiagnostic[] {
  const diagnostics: StatusDiagnostic[] = [];
  for (const l of Object.values(state.learners)) {
    const c = state.clients[l.clientId];
    if (!c) continue;
    let lastMiss: string | undefined;
    const events = state.sourceEvents.filter(e => e.clientId === c.id && e.at >= l.enabledAt && e.at <= now && !state.operations['status:' + e.id])
      .sort((a,b) => a.at - b.at || a.id.localeCompare(b.id, 'en', { numeric: true }));
    // Validate the complete available history before advancing periods or consuming any receipts.
    if ((events.at(-1)?.newStatus ?? l.status) !== c.status) {
      if (!l.syncError) {
        l.syncError = 'status-history-missing'; l.version++;
        diagnostics.push({event:'mentor_status_sync',clientId:c.id,code:'mentor_status_history_required'});
      }
      continue;
    }
    if (l.syncError) {
      delete l.syncError; l.version++;
      diagnostics.push({event:'mentor_status_sync',clientId:c.id,code:'mentor_status_history_recovered'});
    }
    // Stop a cycle retained under the previous policy without rewriting historical counters.
    if (l.active && !CHECKIN_STATUSES.has(l.status)) {stopCheckins(state,l);l.version++;}
    for (const event of events) {
      const key = 'status:' + event.id;
      if (state.operations[key]) continue;
      // Exclusion at a boundary wins over opening/penalising at that same instant.
      lastMiss = advance(state, l, event.at, false) ?? lastMiss;
      changeStatus(state, l, event.newStatus, event.at);
      state.operations[key] = { at: now };
    }
    // Newly eligible statuses start now; do not charge for weeks disabled by the old policy.
    if (!l.active && CHECKIN_STATUSES.has(l.status)) {startCheckins(l,now);l.version++;}
    lastMiss = advance(state, l, now, true) ?? lastMiss;
    if (!l.active || !CHECKIN_STATUSES.has(l.status)) continue;
    if (lastMiss) {
      for (const d of Object.values(state.deliveries)) {
        if (d.clientId === c.id && d.id.startsWith('miss:') && ['pending','sending'].includes(d.state)) d.state = 'cancelled';
      }
      const ch = state.checkins[lastMiss];
      if (l.recruiterMisses || l.interviewMisses) report(state,c,'miss:' + lastMiss,{type:'miss-report',
        start:ch.start,end:ch.end,recruiterMisses:l.recruiterMisses,interviewMisses:l.interviewMisses},reportChatId,now);
    }
    const ch = Object.values(state.checkins).find(ch => ch.clientId === c.id && ch.state === 'open' && ch.end <= now && ch.closesAt > now);
    if (!ch || ch.result) continue;
    enqueue(state, { id: 'reminder:' + ch.id, clientId: c.id, kind: 'reminder', relevance: 'checkin', checkinId: ch.id, expiresAt: ch.closesAt,
      template:{type:'checkin-reminder',start:ch.start,end:ch.end},
      input: { chatId: c.chatId, text: '',
        replyMarkup: { inline_keyboard: [[{ text: '📋 Еженедельный чекин', callback_data: 'mentor:checkin' }]] } } }, now);
    if (now >= mondayAfter(ch.end)) {
      const key = 'monday:' + ch.id;
      report(state,c,key,{type:'monday-report'},reportChatId,now);
      const d = state.deliveries[key + ':report']; d.relevance = 'checkin'; d.checkinId = ch.id; d.expiresAt = ch.closesAt;
    }
  }
  for (const l of Object.values(state.learners)) {
    const c = state.clients[l.clientId];
    if (!c || l.syncError || l.status !== 'studying' || l.hardCompletedAt === undefined || l.ready) continue;
    const n = Math.floor((now - l.hardCompletedAt) / WEEK);
    const due = l.hardCompletedAt + n * WEEK;
    if (n < 1 || (l.readyAt !== undefined && due < l.readyAt)) continue;
    const key = 'pitch:' + c.id + ':' + due;
    enqueue(state,{id:key,clientId:c.id,kind:'reminder',relevance:'pitch',expiresAt:due+WEEK,relevanceAt:due,template:{type:'pitch-reminder'},input:{
      chatId:c.chatId,text:'',
      replyMarkup:{inline_keyboard:[[{text:'🎤 Готовность к самопрезентации',callback_data:'mentor:ready'}],[HOME]]}
    }},now);
    report(state,c,key,{type:'pitch-report',days:Math.floor((now-l.hardCompletedAt)/DAY)},reportChatId,now);
    state.deliveries[key + ':report'].relevance = 'pitch';
    state.deliveries[key + ':report'].expiresAt = due + WEEK;
    state.deliveries[key + ':report'].relevanceAt = due;
  }
  return diagnostics;
}
export async function tick(store: Store, now: number, reportChatId: string,
  log?: (event: Record<string, unknown>) => void): Promise<void> {
  const diagnostics = await store.transaction(state => reconcile(state,now,reportChatId));
  for (const event of diagnostics) { try { log?.(event); } catch {} }
}

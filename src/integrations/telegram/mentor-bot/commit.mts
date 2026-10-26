import type { Client, Learner, Session, State } from './types.mts';
import { allowed, CHECKIN_STATUSES, MARKET_OPTIONS, mergeMarket, responsesStatus, username } from './policy.mts';
import { changeStatus } from './schedule.mts';
import { startHardPreparation } from './hard-preparation.mts';
import { enqueue, HOME, notify, report } from './messages.mts';
/** Called only after authorization and loading the current client in the business transaction. */
export function commit(state: State, s: Session, c: Client, l: Learner, now: number, reportChat: string): 'saved' | 'same' | 'invalid' {
  const key = 'commit:' + s.id + ':' + s.revision;
  let before: unknown, after: unknown;
  if (s.action === 'onboarding') {
    if (!allowed(s.role,s.action,c)) return 'invalid';
    before = c.status; after = 'studying';
    startHardPreparation(l);
    c.status = 'studying'; changeStatus(state,l,c.status,now);
    notify(state,c,key,{type:'onboarding-notice'},now);
  } else if (s.action === 'hard') {
    if (l.hardCompletedAt !== undefined) return 'same';
    before = null; l.hardCompletedAt = now; after = now;
    enqueue(state,{id:key+':instruction',clientId:c.id,kind:'instruction',template:{type:'hard-instruction'},input:{chatId:c.chatId,text:'',
      replyMarkup:{inline_keyboard:[[{text:'🎤 Готовность к самопрезентации',callback_data:'mentor:ready'}],[HOME]]}}},now);
    report(state,c,key,{type:'hard-report',actor:s.owner},reportChat,now);
  } else if (s.action === 'ready') {
    if (s.value !== 'yes' && s.value !== 'no') return 'invalid';
    const ready = s.value === 'yes';
    if (l.ready === ready) return 'same';
    before = l.ready ?? null; after = ready;
    const repeat = l.everReady;
    l.ready = ready; l.readyAt = now; l.readyActor = s.owner;
    if (ready) {
      l.everReady = true;
      notify(state,c,key,{type:'ready-notice'},now);
      report(state,c,key,{type:'ready-report',repeat:!!repeat,actor:s.owner},reportChat,now);
    } else if (before === true) {
      const template = {type:'ready-revoked' as const,actor:s.owner};
      notify(state,c,key,template,now); report(state,c,key,template,reportChat,now);
    }
  } else if (s.action === 'mentor') {
    if (!s.mentorType || !username(s.value ?? '')) return 'invalid';
    const field = s.mentorType === 'hard' ? 'hardMentor' : 'softMentor';
    before = c[field]; after = '@' + username(s.value!);
    if (username(c[field]) === username(s.value!)) return 'same';
    c[field] = String(after);
    notify(state,c,key,{type:'mentor-notice',mentorType:s.mentorType},now);
    report(state,c,key,{type:'mentor-report',mentorType:s.mentorType,before:String(before),after:String(after),actor:s.owner},reportChat,now);
  } else if (s.action === 'market' || s.action === 'responses') {
    const market = s.value === 'ru' || s.value === 'en' || s.value === 'both' ? s.value : undefined;
    const next = s.action === 'market'
      ? market && MARKET_OPTIONS[market].status
      : responsesStatus(c.status);
    if (!next) return 'invalid';
    const combined = mergeMarket(c.market,s.action === 'market' ? market! : next === 'on en market' ? 'en' : 'ru');
    if (next === c.status && c.market === combined) return 'same';
    before = {status:c.status,market:c.market};
    c.market = combined;
    after = {status:next,market:c.market};
    c.status = next; changeStatus(state,l,next,now);
    if (s.action === 'market') {
      // The existing client-lifecycle owns the student automation triggered by this status.
      report(state,c,key,{type:'market-report',market:s.value!,actor:s.owner},reportChat,now);
      notify(state,c,key,{type:'market-notice',status:next},now);
    } else {
      const market = next === 'on en market' ? 'ВУ' : 'РУ';
      notify(state,c,key,{type:'responses-notice',market},now);
      report(state,c,key,{type:'responses-report',market,actor:s.owner},reportChat,now);
    }
  } else if (s.action === 'checkin') {
    const ch = state.checkins[s.checkinId!];
    if (!CHECKIN_STATUSES.has(c.status) || !l.active || !ch || ch.state !== 'open' || ch.closesAt <= now || !s.firstConfirmed ||
      typeof s.recruiters !== 'boolean' || typeof s.interviews !== 'boolean') return 'invalid';
    before = ch.result ? structuredClone(ch.result) : null;
    if (ch.result?.recruiters === s.recruiters && ch.result?.interviews === s.interviews) return 'same';
    ch.result = { recruiters:s.recruiters,interviews:s.interviews,actor:s.owner,at:now };
    ch.version++; after = structuredClone(ch.result);
    l.recruiterMisses = 0; l.interviewMisses = 0;
    report(state,c,key,{type:'checkin-report',checkin:ch,before:before === null ? undefined : before as typeof ch.result},reportChat,now);
    s.checkinVersion = ch.version;
  } else return 'invalid';
  l.version++;
  state.history[key] = {id:key,clientId:c.id,actor:s.owner,at:now,action:s.action,before,after};
  return 'saved';
}

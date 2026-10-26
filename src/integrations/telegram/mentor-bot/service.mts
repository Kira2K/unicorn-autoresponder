import { randomUUID } from 'node:crypto';
import type { Action, Client, Input, Learner, Membership, Outcome, Session, State, Store } from './types.mts';
import { allowed, authorize, CHECKIN_STATUSES, clientVersion, EXCLUDED, responsesStatus, username } from './policy.mts';
import { enqueue, notify, report } from './messages.mts';
import { reconcile } from './schedule.mts';
import { stage } from './stage.mts';
import { commit } from './commit.mts';
import { commitUncertain, configurationFailure, storageFailureCode, telegramErrorCode } from './failures.mts';
import type { StatusDiagnostic } from './schedule.mts';
import type { MessageTemplate } from './message-templates.mts';
import { ERROR_TEXTS } from './error-texts.mts';
import { combineDialogueFeedback } from './dialogue-feedback.mts';

const COMMANDS: Record<string, Action> = {
  start:'menu', menu:'menu', what_my_stage:'stage', hard_done:'hard', ready_pitch:'ready',
  market_ru:'market',market_en:'market',market_both:'market',responses_started:'responses',change_mentor:'mentor'
};
const MENU_ACTIONS:Action[]=['stage','onboarding','hard','ready','market','responses','mentor','checkin'];
export function createMentorService(options: {
  store: Store; member: Membership; reportChatId: string; now: () => number; id?: () => string; botUsername?: string;
  staffAllowed?: (client:Client,actor:string)=>boolean;
  log?: (event: Record<string, unknown>) => void;
}) {
  const id = options.id ?? (() => randomUUID().replaceAll('-','').slice(0,16));
  return {
    async handle(input: Input): Promise<Outcome> {
      const shared = input.callback?.match(/^mentor:(home|stage|ready|checkin)$/);
      const callback = input.callback?.match(/^m:([a-zA-Z0-9_-]{1,20}):(\d+):([a-z-]+)$/);
      const command = input.text?.trim().match(/^\/([a-z_]+)(?:@([a-zA-Z0-9_]+))?(?:\s|$)/);
      if (command && (!COMMANDS[command[1]] || (command[2] &&
          (!options.botUsername || username(command[2]) !== username(options.botUsername))))) return {code:'invalid'};
      if (input.callback && !shared && !callback) return {code:'invalid'};
      let interaction = !!(shared || callback || command), saving = false;
      if (!username(input.username) || !Number.isSafeInteger(input.userId) || input.userId <= 0 ||
          !Number.isSafeInteger(input.updateId) || input.updateId < 0) return { code:'denied' };
      try {
        if (!await options.member(input.chatId,input.userId)) return {code:'denied',...(interaction?{error:'accessDenied' as const}:{})};
      } catch (error) {
        if (configurationFailure(error)) throw error;
        const denied = [400,403].includes(telegramErrorCode(error) ?? 0);
        return {code:denied?'denied':'unavailable',...(interaction?{error:denied?'accessDenied' as const:'accessUnavailable' as const}:{})};
      }
      let diagnostics: StatusDiagnostic[] = [];
      try {
        const result = await options.store.transaction<Outcome>(state => {
          const previousDeliveries = new Set(Object.keys(state.deliveries));
          let dialogueAuthorized = false;
          const outcome = (():Outcome => {
          const eventKey = 'update:' + input.updateId;
          if (state.operations[eventKey]) return {code:'duplicate'};
          const now = options.now();
          diagnostics = reconcile(state,now,options.reportChatId);
          const bound = Object.values(state.clients).filter(c => c.chatId === input.chatId);
          if (bound.length !== 1 || !state.learners[bound[0].id])
            return {code:'denied',...(interaction?{error:'studentUnresolved' as const}:{})};
          const access = authorize(state,input.chatId,input.username);
          if (!access) return {code:'denied',...(interaction?{error:'accessDenied' as const}:{})};
          const {client:c,role} = access, l = state.learners[c.id], owner = username(input.username);
          if(role==='staff'&&options.staffAllowed&&!options.staffAllowed(c,owner))
            return {code:'denied',...(interaction?{error:'accessDenied' as const}:{})};
          interaction ||= Object.values(state.sessions).some(s => s.owner === owner && s.chatId === c.chatId && s.step === 'mentor-input');
          const notice = (text: string | MessageTemplate, code: Outcome['code'] = 'invalid'): Outcome => {
            notify(state,c,eventKey,text,now);
            state.operations[eventKey] = {at:now};
            return {code};
          };
          if (l.syncError) return interaction ? notice({type:'sync-error'}) : {code:'invalid'};
          dialogueAuthorized = true;
          let session: Session | undefined;
          let control = '';
          let action: Action | undefined = shared ? (shared[1] === 'home' ? 'menu' : shared[1] as Action) : command ? COMMANDS[command[1]] : undefined;
          if (callback) {
            session = state.sessions[callback[1]];
            if (!session || session.chatId !== input.chatId || session.clientId !== c.id)
              return notice(ERROR_TEXTS.accessDenied,'denied');
            if (session.revision !== Number(callback[2]) || !session.messageId || session.messageId !== input.messageId)
              return notice(ERROR_TEXTS.screenStale,'stale');
            control = callback[3];
            if (session.owner !== owner) {
              // Menu launches open an independent draft; permissions are checked below for its current owner.
              if (session.action !== 'menu' || !MENU_ACTIONS.includes(control as Action))
                return notice(ERROR_TEXTS.accessDenied,'denied');
              action = control as Action;
              session = undefined;
            } else {
              session.role = role;
              if (session.action === 'menu' && MENU_ACTIONS.includes(control as Action)) action = control as Action;
            }
          } else if (!action && !input.callback && !command) {
            session = Object.values(state.sessions).find(s => s.owner === owner && s.chatId === c.chatId && s.step === 'mentor-input');
            if (!session) return {code:'invalid'};
            interaction = true;
            control = 'username';
          } else if (!action) return {code:'invalid'};
          if (!username(c.username)) {
            report(state,c,eventKey,ERROR_TEXTS.studentUsernameInvalid,options.reportChatId,now);
            if (!allowed(role,action ?? session!.action,c)) {
              state.operations[eventKey] = {at:now};
              return {code:'denied'};
            }
          }
          if (!allowed(role,action ?? session!.action,c)) return notice(ERROR_TEXTS.accessDenied,'denied');
          if (action) {
            if (!session) {
              const previous = Object.values(state.sessions).find(s => s.owner === owner && s.chatId === c.chatId);
              const source = input.callback && input.messageId ? Object.values(state.sessions).find(s =>
                s.chatId === c.chatId && s.messageId === input.messageId) : undefined;
              const messageId = command ? undefined : previous?.messageId ?? (input.callback && !source ? input.messageId : undefined);
              for (const [key,s] of Object.entries(state.sessions)) if (s.owner === owner && s.chatId === c.chatId) delete state.sessions[key];
              session = {id:id(),clientId:c.id,chatId:c.chatId,owner,role,action,step:'menu',revision:0,
                expectedVersion:l.version,expectedClient:clientVersion(c),createdAt:now,...(messageId?{messageId}:{})};
              state.sessions[session.id] = session;
            }
            reset(session,action,c,l);
            if (action === 'checkin') {
              if (EXCLUDED.has(c.status)) return notice({type:'checkin-excluded',status:c.status});
              if (!CHECKIN_STATUSES.has(c.status) || l.activatedAt === undefined) return notice('Чекин доступен на этапах подготовки к рынку и откликов.');
              const ch = Object.values(state.checkins).find(ch => ch.clientId === c.id && ch.state === 'open' && ch.end <= now && ch.closesAt > now);
              if (!ch) return notice('Следующий чекин будет доступен в четверг в 17:00 МСК.');
              session.checkinId = ch.id; session.checkinVersion = ch.version; session.step = ch.result ? 'result' : 'q1';
            }
            if (action === 'market' && command && command[1] !== 'menu') {
              session.value = command[1].slice('market_'.length); session.step = 'confirm';
            }
            if (action === 'responses' && !responsesStatus(c.status))
              return notice({type:'responses-unavailable'});
            if (action === 'stage' && !stage(c,l).known)
              report(state,c,eventKey,{type:'stage-unmapped',status:c.status},options.reportChatId,now);
          } else if (session) {
            if (session.action === 'checkin') {
              const ch = state.checkins[session.checkinId!];
              if (!CHECKIN_STATUSES.has(c.status) || !ch || ch.state !== 'open' || ch.closesAt <= now)
                return notice('Этот чекин закрыт. Открой доступный чекин через главное меню.','stale');
              if (ch.version !== session.checkinVersion) {
                session.checkinVersion = ch.version; session.step = ch.result ? 'result' : 'q1';
                session.expectedVersion = l.version; session.expectedClient = clientVersion(c);
                delete session.firstConfirmed; delete session.recruiters; delete session.interviews;
                draw(state,session,c,l,eventKey,now);
                state.operations[eventKey] = {at:now}; return {code:'stale'};
              }
            }
            if (control === 'cancel') {
              if (session.action === 'checkin' || !['onboarding','hard','market','responses','mentor'].includes(session.action)) return {code:'invalid'};
              reset(session,'menu',c,l);
              notice('Выбор отменён. Изменения не сохранены.','ok');
            } else if (control === 'back') {
              if (session.action === 'checkin' && session.step === 'q2') {
                session.step='q1'; delete session.firstConfirmed; delete session.interviews;
              } else if (session.action === 'mentor' && session.step === 'mentor-input') reset(session,'mentor',c,l);
              else reset(session,'menu',c,l);
            } else if (control === 'edit') {
              if (session.action === 'checkin') {
                if (session.step === 'result') {
                  session.step='q1'; delete session.firstConfirmed; delete session.interviews; delete session.recruiters;
                } else if (session.step === 'q1-confirm') {session.step='q1'; delete session.firstConfirmed;}
                else if (session.step === 'q2-confirm') session.step='q2';
                else return {code:'invalid'};
              } else if (session.action === 'mentor') session.step='mentor-input';
              else if (session.action === 'ready' || session.action === 'market') session.step='select';
              else return {code:'invalid'};
              session.expectedVersion=l.version; session.expectedClient=clientVersion(c);
            } else if (control === 'username') {
              if (session.action !== 'mentor' || session.step !== 'mentor-input') return {code:'invalid'};
              const tag=username(input.text ?? '');
              if (!tag) return notice('Введи корректный @username ментора.');
              session.value=tag;session.step='confirm';
            } else if (session.action === 'mentor' && session.step === 'select' && ['hard-type','soft-type'].includes(control)) {
              session.mentorType=control === 'hard-type' ? 'hard' : 'soft';session.step='mentor-input';
            } else if (session.action === 'market' && session.step === 'select' && ['ru','en','both'].includes(control)) {
              session.value=control;session.step='confirm';
            } else if (['yes','no'].includes(control)) {
              if (session.action === 'ready' && session.step === 'select') {session.value=control;session.step='confirm';}
              else if (session.action === 'checkin' && session.step === 'q1') {
                session.recruiters=control === 'yes';session.firstConfirmed=false;delete session.interviews;session.step='q1-confirm';
              } else if (session.action === 'checkin' && session.step === 'q2' && session.firstConfirmed) {
                session.interviews=control === 'yes';session.step='q2-confirm';
              } else return {code:'invalid'};
            } else if (control === 'confirm') {
              if (session.expectedVersion !== l.version || session.expectedClient !== clientVersion(c)) {
                reset(session,'menu',c,l);
                notice(ERROR_TEXTS.dataChanged,'stale');
                draw(state,session,c,l,eventKey,now); return {code:'stale'};
              }
              if (session.action === 'checkin' && session.step === 'q1-confirm' && typeof session.recruiters === 'boolean') {
                session.firstConfirmed=true;session.step='q2';
              } else {
                if (session.step !== 'confirm' && !(session.action === 'checkin' && session.step === 'q2-confirm')) return {code:'invalid'};
                const result=commit(state,session,c,l,now,options.reportChatId);
                saving = result === 'saved';
                if (result === 'invalid') return notice(ERROR_TEXTS.saveFailed);
                if (result === 'same') notice('Эти данные уже сохранены. Изменений нет.','ok');
                if (session.action === 'ready' || session.action === 'checkin') session.step='result';
                else reset(session,'menu',c,l);
                session.expectedVersion=l.version;session.expectedClient=clientVersion(c);
              }
            } else return {code:'invalid'};
          }
          if (session) draw(state,session,c,l,eventKey,now);
          state.operations[eventKey]={at:now};
          return {code:'ok'};
          })();
          if (outcome.code !== 'duplicate' && (outcome.code !== 'denied' || dialogueAuthorized))
            combineDialogueFeedback(state,input,previousDeliveries,options.now());
          return outcome;
        });
        for (const event of diagnostics) { try { options.log?.(event); } catch {} }
        return result;
      } catch (error) {
        if (configurationFailure(error)) throw error;
        try { options.log?.({event:'mentor_service_failure',code:storageFailureCode(error),updateId:input.updateId}); } catch {}
        return {code:'unavailable',...(interaction ? {error:saving ? (commitUncertain(error)?'saveUncertain' as const:'saveFailed' as const) : 'accessUnavailable' as const} : {})};
      }
    }
  };
}
function reset(s:Session,action:Action,c:Client,l:Learner):void {
  s.action=action;s.step=action === 'menu' || action === 'stage' ? 'menu' :
    action === 'onboarding' || action === 'hard' || action === 'responses' ? 'confirm' : 'select';
  s.expectedVersion=l.version;s.expectedClient=clientVersion(c);
  delete s.value;delete s.mentorType;delete s.checkinId;delete s.checkinVersion;
  delete s.recruiters;delete s.interviews;delete s.firstConfirmed;
}
function draw(state:State,s:Session,c:Client,l:Learner,key:string,now:number):void {
  s.revision++;
  enqueue(state,{id:key+':screen',clientId:c.id,kind:'screen',sessionId:s.id,sessionRevision:s.revision,
    checkinId:s.checkinId,template:{type:'screen'},input:{chatId:c.chatId,text:'',...(s.messageId?{editMessageId:s.messageId}:{})}},now);
}

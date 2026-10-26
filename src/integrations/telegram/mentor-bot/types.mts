import type { SendOneInput, SendOneResult } from '../types.ts';
import type { MessageTemplate } from './message-templates.mts';
import type { ErrorKey } from './error-texts.mts';

export type Role = 'student' | 'staff';
export type Client = {
  id: string; name: string; username: string; chatId: string;
  status: string; market: 'ru' | 'en' | 'both' | null; stack: string;
  hardMentor: string; softMentor: string;
};
export type Learner = {
  clientId: string; enabledAt: number; status: string; version: number;
  hardCompletedAt?: number; ready?: boolean; readyAt?: number; readyActor?: string; everReady?: boolean;
  activatedAt?: number; nextOpenAt?: number; active: boolean;
  recruiterMisses: number; interviewMisses: number;
  syncError?: 'status-history-missing';
};
export type Checkin = {
  id: string; clientId: string; start: number; end: number; closesAt: number;
  state: 'open' | 'closed' | 'cancelled'; version: number;
  result?: { recruiters: boolean; interviews: boolean; actor: string; at: number };
};
export const ACTIONS = ['menu','stage','onboarding','hard','ready','market','responses','mentor','checkin'] as const;
export type Action = typeof ACTIONS[number];
export type Step = 'menu' | 'select' | 'confirm' | 'mentor-input' | 'q1' | 'q1-confirm' | 'q2' | 'q2-confirm' | 'result';
export type Session = {
  id: string; clientId: string; chatId: string; owner: string; role: Role;
  action: Action; step: Step; revision: number; expectedVersion: number;
  expectedClient: string; messageId?: number; createdAt: number;
  value?: string; mentorType?: 'hard' | 'soft';
  checkinId?: string; checkinVersion?: number; recruiters?: boolean; interviews?: boolean; firstConfirmed?: boolean;
};
export type Delivery = {
  /** Only static transport feedback may be independent of a client binding. */
  id: string; clientId?: string; kind: 'screen' | 'notice' | 'report' | 'reminder' | 'instruction' | 'feedback';
  input: SendOneInput; state: 'pending' | 'sending' | 'sent' | 'blocked' | 'cancelled';
  attempts: number; retryAt: number; claimedAt?: number; messageId?: number; error?: string;
  sessionId?: string; sessionRevision?: number; checkinId?: string; relevance?: 'checkin' | 'pitch';
  expiresAt?: number; relevanceAt?: number;
  template?: MessageTemplate;
};
export type Audit = {
  id: string; clientId: string; actor: string; at: number; action: string;
  before: unknown; after: unknown;
};
export type StatusEvent = { id: string; clientId: string; oldStatus: string; newStatus: string; at: number };
export type State = {
  clients: Record<string, Client>; learners: Record<string, Learner>;
  sessions: Record<string, Session>; checkins: Record<string, Checkin>;
  deliveries: Record<string, Delivery>; operations: Record<string, { at: number }>;
  history: Record<string, Audit>; sourceEvents: StatusEvent[]; offset: number;
};
export interface Store {
  /** Callback is synchronous: no external calls inside a business transaction. */
  transaction<T>(operation: (state: State) => T): Promise<T>;
  /** Optional narrow paths; adapters without them retain the transaction fallback. */
  cursor?: { read(): Promise<number>; advance(nextOffset: number): Promise<void> };
  deliveryTransaction?<T>(scope: DeliveryScope, operation: (state: DeliveryState) => T): Promise<T>;
}
export type DeliveryScope = { now: number; leaseMs: number; deliveryId?: string };
export type DeliveryState = Pick<State, 'clients' | 'learners' | 'sessions' | 'checkins' | 'deliveries'>;
export type Actor = { username: string; chatId: string; userId: number };
export type Input = Actor & {
  updateId: number; text?: string; callback?: string; messageId?: number;
};
export type Outcome = { code: 'ok' | 'duplicate' | 'denied' | 'stale' | 'invalid' | 'unavailable';
  /** Error not queued in the business transaction; runtime sends it without accessing storage. */
  error?: Exclude<ErrorKey, 'studentUsernameInvalid'> };
export type Sender = (input: SendOneInput) => Promise<SendOneResult>;
export type Membership = (chatId: string, userId: number) => Promise<boolean>;
export function emptyState(clients: Client[] = []): State {
  return { clients: Object.fromEntries(clients.map(c => [c.id, c])), learners: {}, sessions: {},
    checkins: {}, deliveries: {}, operations: {}, history: {}, sourceEvents: [], offset: 0 };
}

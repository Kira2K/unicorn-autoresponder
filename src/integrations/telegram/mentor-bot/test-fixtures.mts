import type { Client, Learner } from './types.mts';
export const START = Date.parse('2026-10-20T09:00:00Z');
export function fixtureClient(patch: Partial<Client> = {}): Client {
  return { id: '1', name: 'Тестовый ученик', username: '@alice', chatId: '-100',
    status: 'studying', market: 'ru', stack: 'TypeScript', hardMentor: '@hardmentor', softMentor: '@softmentor', ...patch };
}
export function fixtureLearner(patch: Partial<Learner> = {}): Learner {
  return { clientId: '1', enabledAt: START, status: 'studying', version: 0, active: false,
    recruiterMisses: 0, interviewMisses: 0, ...patch };
}

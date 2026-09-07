import { makeRun } from '../run-model.ts'
import { fixture } from './fixtures.ts'
import type { ConnectionHistoryItem, ConnectionRun } from '../types.ts'

export const INVITATION_TEST_STARTED_AT = new Date('2026-08-24T09:00:00Z')

export function invitationCandidate(run: ConnectionRun, personId: string): ConnectionHistoryItem {
  return {
    historyKey: `${run.accountId}:${personId}`, runId: run.runId,
    platformAccountId: run.platformAccountId, accountId: run.accountId, personId,
    audience: 'recruiter', searchKey: 'recruiter-test', name: `Candidate ${personId}`,
    headline: 'Technical Recruiter', location: 'Berlin', status: 'eligible',
    reasonCode: 'candidate_eligible', discoveredAt: INVITATION_TEST_STARTED_AT.toISOString(),
    updatedAt: INVITATION_TEST_STARTED_AT.toISOString()
  }
}

export function invitationRuntime(test: ReturnType<typeof fixture>, options: {
  now?: () => Date; sleep?: (milliseconds: number) => Promise<void>
  stopRequested?: () => boolean; logger?: { event(...args: any[]): void }
} = {}) {
  return {
    store: test.store, repository: test.repository, adapter: () => test.adapter,
    writerEnabled: true, writerId: 'test-writer',
    now: options.now ?? (() => INVITATION_TEST_STARTED_AT), timeZone: 'Europe/Moscow',
    random: () => 0, sleep: options.sleep ?? (async () => undefined),
    stopRequested: options.stopRequested ?? (() => false), emit() {},
    logger: options.logger ?? test.logger, assertWriterOwnership() {}
  }
}

export function invitationRun() {
  return makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test', stack: 'GO' },
  INVITATION_TEST_STARTED_AT, 'Europe/Moscow', false)
}

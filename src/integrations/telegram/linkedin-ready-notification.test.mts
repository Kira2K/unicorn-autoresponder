import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { workflowFixture } from '../../features/web-console/backend/postgres/workflow-fixture.mts'
import { workflowEnv } from '../../features/web-console/backend/postgres/workflow-scenario.mts'

const { resumeWorkflowById } = createRequire(import.meta.url)('./resume-workflow.ts')
const student = { userId: '9001', username: 'sql_student', chatId: '-7007', chatType: 'supergroup' }
for (const backend of ['legacy', 'sql'] as const) {
  for (const market of ['Ru', 'En', 'both']) {
    test(`${backend}/${market}: disabling LinkedIn-ready keeps completion and other notifications`, async t => {
      t.mock.method(globalThis, 'fetch', () => assert.fail('This test must not access external services'))
      const previousEnabled = process.env.RESUME_WORKFLOW_LINKEDIN_READY_ENABLED
      const previousSummary = process.env.summary_logs_channel_id
      const restore = workflowEnv([7])
      try {
        process.env.RESUME_WORKFLOW_TEST_MODE = 'false'
        process.env.summary_logs_channel_id = '-summary-test-only'
        const kinds: string[][] = []
        for (const enabled of [undefined, 'true', 'false', ' FALSE ']) {
          if (enabled === undefined) delete process.env.RESUME_WORKFLOW_LINKEDIN_READY_ENABLED
          else process.env.RESUME_WORKFLOW_LINKEDIN_READY_ENABLED = enabled
          process.env.RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID = enabled === ' FALSE ' ? '' : '-9005'
          const repository = workflowFixture(market)[backend]
          const initial = await repository.getResumeWorkflowByTelegramChatId('-7007', { ensure: true })
          await repository.patchResumeWorkflow(initial!.id, {
            status: 'Russian version in approve by student',
            enVersionUrl: market === 'Ru' ? '' : 'https://example.invalid/en', ruVersionUrl: 'https://example.invalid/ru'
          })
          const result = await resumeWorkflowById(initial!.id, repository, { actor: student })
          assert.equal(result.workflow.status, 'CV done')
          assert.equal(result.transitions.length, 1)
          const notifications = result.notifications
          assert.equal(notifications.some((item: any) => item.kind === 'linkedin_ready'),
            market !== 'Ru' && enabled?.trim().toLowerCase() !== 'false')
          assert.ok(notifications.some((item: any) => item.kind === 'private_kira'))
          kinds.push(notifications.filter((item: any) => item.kind !== 'linkedin_ready').map((item: any) => item.kind))
          if (enabled?.trim().toLowerCase() === 'false') {
            process.env.RESUME_WORKFLOW_LINKEDIN_READY_ENABLED = 'true'
            const completed = await repository.getResumeWorkflowById(initial!.id)
            await assert.rejects(resumeWorkflowById(initial!.id, repository, { actor: student }), { code: 'resume_workflow_noop' })
            assert.deepEqual(await repository.getResumeWorkflowById(initial!.id), completed)
          }
        }
        for (const otherKinds of kinds) assert.deepEqual(otherKinds, kinds[0])
      } finally {
        restore()
        if (previousEnabled === undefined) delete process.env.RESUME_WORKFLOW_LINKEDIN_READY_ENABLED
        else process.env.RESUME_WORKFLOW_LINKEDIN_READY_ENABLED = previousEnabled
        if (previousSummary === undefined) delete process.env.summary_logs_channel_id
        else process.env.summary_logs_channel_id = previousSummary
      }
    })
  }
}

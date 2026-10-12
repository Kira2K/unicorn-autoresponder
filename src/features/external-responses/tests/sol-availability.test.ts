import test from 'node:test'
import assert from 'node:assert/strict'
import { requireSolAvailability } from '../infrastructure/sol-availability.ts'

test('exact Sol model and each role effort require affirmative catalog evidence',async()=>{
  const client={readModels:async()=>[{model:'gpt-6-sol',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}]}
  for(const effort of ['medium','high'] as const)assert.equal((await requireSolAvailability(client,effort)).model,'gpt-6-sol')
})
test('other Sol version and a matching display name cannot silently substitute',async()=>{
  const client={readModels:async()=>[{model:'gpt-5.6-sol',displayName:'gpt-6-sol'}]}
  await assert.rejects(requireSolAvailability(client,'high'),/sol_model_not_listed:gpt-6-sol/)
})
test('missing effort or failed catalog remains blocked',async()=>{
  await assert.rejects(requireSolAvailability({readModels:async()=>[{model:'gpt-6-sol'}]},'medium'),/reasoning_effort_not_listed/)
  await assert.rejects(requireSolAvailability({readModels:async()=>{throw Error('offline')}},'high'),/offline/)
})

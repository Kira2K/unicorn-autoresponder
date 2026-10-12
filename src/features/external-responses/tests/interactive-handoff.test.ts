import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertInteractiveHandoff } from '../application_workflow/interactive-handoff.ts'

test('live verification handoff requires interactive stdin before opening a browser', () => {
  assert.throws(() => assertInteractiveHandoff(true, false, undefined), /interactive_verification_channel_required/)
  assert.throws(() => assertInteractiveHandoff(true, false, false), /interactive_verification_channel_required/)
  assert.doesNotThrow(() => assertInteractiveHandoff(true, false, true))
  assert.doesNotThrow(() => assertInteractiveHandoff(true, true, false))
  assert.doesNotThrow(() => assertInteractiveHandoff(false, false, false))
})

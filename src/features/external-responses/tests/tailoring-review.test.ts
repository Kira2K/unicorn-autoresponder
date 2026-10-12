import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareTailoring } from './helpers/tailored-review.ts'
test('test review detects unchanged original and generic repeated text independently of PDF metadata', () => {
  assert.equal(compareTailoring({ textHash: 'same' }, { textHash: 'same' }, 'jobA').unchangedText, true)
  assert.equal(compareTailoring({ textHash: 'original' }, { textHash: 'generic' }, 'jobB', [{ textHash: 'generic', descriptionHash: 'jobA' }]).repeatedAcrossDifferentDescriptions, true)
  assert.deepEqual(compareTailoring({ textHash: 'original' }, { textHash: 'specific' }, 'jobB', [{ textHash: 'other', descriptionHash: 'jobA' }]), { unchangedText: false, repeatedAcrossDifferentDescriptions: false })
})

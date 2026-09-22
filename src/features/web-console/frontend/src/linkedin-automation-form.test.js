import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSlotTime, normalizeAutomationDraft, automationFormError } from './linkedin-automation-form.js'
import { validateSettings } from '../../../linkedin-automation/orchestrator/calendar.ts'

const draft = () => ({enabled:false,timezone:'Europe/Moscow',slots:[
  {id:'tuesday',day:2,start:'02:00',end:'12',features:['invitations','comments','withdrawals']}]})

test('short end time from the reported form becomes a backend-valid time without enabling automation',()=>{
  const original=draft(),settings=normalizeAutomationDraft(original)
  assert.equal(settings.slots[0].end,'12:00')
  assert.equal(settings.enabled,false)
  assert.equal(validateSettings(105,settings,0,0).slots[0].end,'12:00')
  assert.equal(original.slots[0].end,'12')
  assert.notEqual(settings.slots[0].features,original.slots[0].features)
})

test('hours and end-of-day normalize without rolling invalid times into another day',()=>{
  for (const [input,expected] of [['9','09:00'],['9:30','09:30'],[' 12:00 ','12:00'],['24','24:00'],['24:00','24:00']])
    assert.equal(normalizeSlotTime(input,true),expected)
  assert.equal(normalizeSlotTime('24'),undefined)
  for(const input of ['', '25','24:01','12:60','12:','12abc','12.5','-1',null])
    assert.equal(normalizeSlotTime(input,true),undefined)
})

test('invalid or reversed times produce an actionable error before saving',()=>{
  const value=draft();value.slots[0].end='25'
  assert.throws(()=>normalizeAutomationDraft(value),/Вт: укажи время «До»/)
  value.slots[0].end='01:00'
  assert.throws(()=>normalizeAutomationDraft(value),/должно быть позже/)
  value.slots[0].end='24'
  assert.doesNotThrow(()=>validateSettings(105,normalizeAutomationDraft(value),0,0))
})

test('schedule validation codes have a user-facing explanation',()=>{
  assert.match(automationFormError('automation_slot_invalid'),/выбери хотя бы одну фичу/)
  assert.match(automationFormError('automation_slots_overlap'),/пересекающиеся/)
  assert.equal(automationFormError('База данных недоступна'),'База данных недоступна')
})

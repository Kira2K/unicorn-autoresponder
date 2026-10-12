import test from 'node:test'
import assert from 'node:assert/strict'
import { descriptionMarket } from '../vacancy_collection/description-market.ts'
import { monthlyUsd } from '../stack_classification/salary.ts'
import { higherSeniorityGate } from '../candidate_matching/seniority.ts'
import { createStackAssessor } from '../stack_classification/ai.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { createReviewedAssessors } from '../stack_classification/reviewed-assessor.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'

test('market follows the description language, not company domain, location or jurisdiction', () => {
  assert.equal(descriptionMarket('We are looking for an engineer to build our Java backend services. You will work with the team.').value, 'global')
  assert.equal(descriptionMarket('Мы ищем разработчика Java. Вы будете разрабатывать сервисы и работать с нашей командой. Наши требования: опыт работы с Spring.').value, 'ru')
  assert.equal(descriptionMarket('').value, 'unknown')
})
test('salary arithmetic compares the upper range bound and converts annual/hourly values with recorded FX', () => {
  const fx = { asOf: '2026-09-28', source: 'fixture:rates', usdPerUnit: { EUR: 1.1 } }
  assert.equal(monthlyUsd({ min: 2500, max: 4000, currency: 'USD', period: 'month' }).max, 4000)
  assert.equal(monthlyUsd({ min: 36000, currency: 'USD', period: 'year' }).max, 3000)
  assert.equal(monthlyUsd({ min: 36000, currency: 'EUR', period: 'year' }, fx).max, 3300)
  assert.ok(Math.abs(monthlyUsd({ min: 25, currency: 'USD', period: 'hour', hoursPerWeek: 40 }).max! - 4333.333333333333) < 0.000001)
  assert.equal(monthlyUsd({ min: 25, currency: 'USD', period: 'hour' }).status, 'unknown')
  assert.equal(monthlyUsd({ min: 3000, currency: 'EUR', period: 'month' }).status, 'unknown')
  assert.equal(monthlyUsd({ min: 3000, currency: 'EUR', period: 'month' }, { ...fx, asOf: '' }).status, 'unknown')
  assert.equal(monthlyUsd({ min: 30, currency: 'USD', period: 'hour', hoursPerWeek: Infinity }).status, 'unknown')
})
test('higher positions require an explicit matching CV/rule exception; senior is not an exception requirement', () => {
  assert.equal(higherSeniorityGate('Senior Engineer', []).decision, 'eligible')
  assert.equal(higherSeniorityGate('Staff Engineer', []).decision, 'excluded')
  assert.equal(higherSeniorityGate('Staff Engineer', [{ level: 'lead', source: 'cv', evidence: 'Previous lead role' }]).decision, 'excluded')
  assert.equal(higherSeniorityGate('Staff Engineer', [{ level: 'staff', source: 'student_rule', evidence: 'Explicitly allowed Staff positions' }]).decision, 'eligible')
})
test('stack prompt respects workload limits and missing-framework allowances from SQL, without extra review rules', async () => {
  let instructions = ''
  const assess = createStackAssessor({ respond: async (_a: unknown, _b: unknown, _c: unknown, prompt: string) => { instructions = prompt; return { decision: 'eligible', reasons: ['Fixture'], evidence: ['Build backend services'] } } } as any)
  await assess({ title: 'Java Engineer', description: 'Build backend services', location: '' } as any, { id: '5', name: 'Java', description: 'Java backend; omitted framework is allowed.' })
  assert.match(instructions, /workload/i)
  assert.match(instructions, /missing.*framework/i)
  const rules = await loadSelectionRules()
  assert.match(rules.text, /upper bound/i)
  assert.match(rules.text, /mentoring/i)
  assert.match(rules.text, /AQA/)
})

test('reviewed assessments require current bodies/rules, complete decisions and literal evidence', async () => {
  const rules = await loadSelectionRules(), position = { id: '1', title: 'Java Engineer', location: 'Worldwide', description: 'Develop backend services in Java. Responsibilities include building production APIs, maintaining backend services and databases, and collaborating with the product engineering team.' }
  const collection = { runId: 'reviewed', positions: [position], scope: { stacks: [{ id: 'stack-5', databaseId:'5', name:'Java', description:'Java backend', studentIds:['1'] }] } } as any
  const decision = { decision: 'eligible' as const, reasons: ['Java backend'], evidence: ['Develop backend services in Java.'] }
  const review = { runId: collection.runId, collectionDigest: digest(collection), rulesHash: rules.sha256, reviewedBy: 'fixture', reviewedAt: new Date().toISOString(), origin: 'human' as const, decisions: { '1': { global: decision, stacks: { 'stack-5': decision } } } }
  const assessors = createReviewedAssessors(review, collection, rules)
  assert.equal((await assessors.assessGlobal(position as any)).decision, 'eligible')
  assert.throws(() => createReviewedAssessors({ ...review, rulesHash: 'wrong' }, collection, rules), /stale/)
  assert.throws(() => createReviewedAssessors({ ...review, decisions: {} }, collection, rules), /evidence/)
  assert.throws(() => createReviewedAssessors({ ...review, decisions: { '1': { global: { ...decision, evidence: ['Invented'] }, stacks: {} } } }, collection, rules), /evidence/)
  const locationEvidence = { ...review, decisions: { '1': { global: { ...decision, evidence: [position.location] }, stacks: { 'stack-5': decision } } } }
  assert.doesNotThrow(() => createReviewedAssessors(locationEvidence, collection, rules))
  const dated={...collection,positions:[{...position,publishedAt:'2026-09-13'}]}
  const datedReview={...review,collectionDigest:digest(dated),reviewedAt:'2026-09-28T12:00:00Z'}
  assert.doesNotThrow(()=>createReviewedAssessors(datedReview,dated,rules,new Date('2026-09-29T12:00:00Z')))
})

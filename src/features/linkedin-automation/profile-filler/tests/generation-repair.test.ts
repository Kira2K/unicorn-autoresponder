import assert from 'node:assert/strict'
import { validateWithRepair } from '../generation/validate-with-repair.ts'
import { emptyFacts, generatedDocument } from './generation-fixture.ts'

async function main() {
  const generated = generatedDocument()
  generated.profile.about = 'Backend engineer building reliable services.'
  let repairCalls = 0
  const result = await validateWithRepair({ generated, facts: emptyFacts, country: 'Poland',
    generator: { async repairProfile() {
      repairCalls += 1
      return generatedDocument()
    } }, logger: { event() {} } })
  assert.equal(repairCalls, 1)
  assert.equal(result.issues.some((issue: any) => issue.level === 'fatal'), false)
  assert.equal(result.value.about?.split(/\n\s*\n/).length, 4)
  const twice = generatedDocument(); twice.profile.about = 'Only one block.'
  let calls = 0
  const repairedTwice = await validateWithRepair({ generated: twice, facts: emptyFacts,
    country: 'Poland', logger: { event() {} }, generator: { async repairProfile() {
      calls += 1
      if (calls === 1) return twice
      return generatedDocument()
    } } })
  assert.equal(calls, 2)
  assert.equal(repairedTwice.issues.some((issue: any) => issue.level === 'fatal'), false)
  const unsupported = generatedDocument()
  unsupported.profile.about = `Improved output by 999%.\n\n${unsupported.profile.about}`
  let fallbackCalls = 0
  const fallback = await validateWithRepair({ generated: unsupported, facts: emptyFacts,
    country: 'Poland', logger: { event() {} }, generator: { async repairProfile() {
      fallbackCalls += 1; return unsupported
    } } })
  assert.equal(fallbackCalls, 2)
  assert.equal(fallback.value.about?.includes('999'), false)
  assert.equal(fallback.issues.some((issue: any) => issue.level === 'fatal'), false)
  console.log('profile generation repair tests passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 })

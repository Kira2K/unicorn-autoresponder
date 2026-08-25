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
  console.log('profile generation repair tests passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 })

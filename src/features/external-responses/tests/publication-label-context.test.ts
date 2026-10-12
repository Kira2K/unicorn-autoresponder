import test from 'node:test'
import assert from 'node:assert/strict'
import { publicationContext } from '../vacancy_collection/posting-content.ts'
import { evaluatePublicationDate } from '../vacancy_collection/publication-date-precheck.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'

test('explicit named-month publication dates use calendar validation and the existing age rule',async()=>{
  const now=new Date('2026-10-04T00:00:00Z'),base={description:'',retrievedAt:now.toISOString()}
  const rules=await loadSelectionRules()
  for(const publishedAt of ['October 30th, 2025','October 30, 2025']){
    const p={...base,publishedAt},result=publicationContext(p,now)
    assert.equal(result.publicationDate,'2025-10-30');assert.equal(result.status,'valid')
    assert.equal(evaluatePublicationDate(p,rules,now).decision,'excluded')
  }
  assert.equal(evaluatePublicationDate({...base,publishedAt:'September 19th, 2026'},rules,now).decision,'continue')
  assert.equal(publicationContext({...base,description:'Published on October 30th, 2025'},now).publicationDate,'2025-10-30')
  for(const publishedAt of ['February 30th, 2026','10/11/2026'])assert.equal(publicationContext({...base,publishedAt},now).status,'invalid')
  assert.equal(publicationContext({...base,publishedAt:'October 5th, 2026'},now).status,'future')
})

test('research publication requirements do not become posting dates',()=>{
  const now=new Date('2026-10-04T00:00:00Z')
  for(const description of ['Published work on IR, ranking, or knowledge graphs','Published papers in top-tier journals','Published research is desirable']){
    const result=publicationContext({description,publishedAt:'2026-06-29T04:49:31-04:00',retrievedAt:now.toISOString()},now)
    assert.equal(result.status,'valid');assert.equal(result.publicationDate,'2026-06-29');assert.ok(result.ageDays!>15)
    assert.equal(publicationContext({description,retrievedAt:now.toISOString()},now).status,'missing')
  }
})

test('real invalid, conflicting and unsupported date labels still require inspection',()=>{
  const now=new Date('2026-10-04T00:00:00Z'),base={retrievedAt:now.toISOString(),publishedAt:'2026-09-29'}
  for(const description of ['Published: unavailable','Published September 28, 2026','Date posted: unavailable','Published 2026-09-28','Published 2026-02-30'])assert.notEqual(publicationContext({...base,description},now).status,'valid',description)
  assert.equal(publicationContext({...base,description:'Published 2026-09-29'},now).status,'valid')
})

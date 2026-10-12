import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePostingLink } from '../vacancy_collection/posting-link.ts'
import { positionId } from '../infrastructure/identity.ts'
const url='https://employer.test/careers/job/senior-frontend/123', ats='https://jobs.ashbyhq.com/acme/12345678-1234-1234-1234-123456789abc'
test('explicit Apply link on an individual page resolves the ATS duplicate; repeated controls are one target',()=>{
 const job={url,applyUrl:url}, link={text:'Apply',url:ats+'/application'}
 const result=resolvePostingLink(job,{url:url+'?office=Berlin',links:[link,link]})
 assert.equal(result.applyUrl,link.url);assert.equal(positionId(result.url),positionId(ats));assert.equal(job.url,url)
})
test('listing pages, unrelated links and multiple ATS targets cannot establish a posting alias',()=>{
 const job={url},link={text:'Apply',url:ats}
 assert.deepEqual(resolvePostingLink(job,{url:'https://employer.test/careers',links:[link]}),job)
 assert.deepEqual(resolvePostingLink(job,{url,links:[{...link,text:'All jobs'}]}),job)
 assert.deepEqual(resolvePostingLink(job,{url,links:[link,{...link,url:ats.replace('789abc','789def')}]}),job)
})

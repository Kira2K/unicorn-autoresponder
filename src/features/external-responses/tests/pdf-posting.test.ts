import test from 'node:test'
import assert from 'node:assert/strict'
import {readPostingPdf} from '../vacancy_collection/pdf-reader.ts'
test('PDF postings preserve complete extracted text and require a title in the body',async()=>{
  const text='Senior Golang Developer\nResponsibilities: '+ 'Implement Go services and SQL APIs. '.repeat(30)
  let calls=0
  const fetcher:typeof fetch=async(_url,init)=>{calls++;assert.equal(init?.redirect,'error');return new Response('%PDF- fixture')}
  const page=await readPostingPdf('https://fixture.test/job.pdf',fetcher,async()=>({text,textHash:'hash',pages:2}))
  assert.equal(page?.jobs[0].description,text);assert.equal(page?.jobs[0].title,'Senior Golang Developer')
  const unknown=await readPostingPdf('https://fixture.test/Senior-Python-Developer.pdf',fetcher,async()=>({text:'Company brochure and general information '.repeat(5),textHash:'hash',pages:1}))
  assert.equal(unknown?.jobs.length,0);assert.equal(unknown?.partial,true)
  assert.equal(await readPostingPdf('https://fixture.test/careers',fetcher),undefined);assert.equal(calls,2)
})
test('PDF closure is explicit; errors do not become closure',async()=>{
  assert.match((await readPostingPdf('https://fixture.test/job.pdf',async()=>new Response('',{status:410})))!.closedEvidence!,/410/)
  await assert.rejects(readPostingPdf('https://fixture.test/job.pdf',async()=>new Response('',{status:503})),/503/)
})

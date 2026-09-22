import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {registerLinkedInAutomationRoutes} from './linkedin-automation-routes.ts'
test('diagnostic token can only read; anonymous, malformed IDs and stale revisions are rejected',async()=>{
  const app=express();app.use(express.json());let writes=0
  const service:any={snapshot:async()=>({ok:true}),diagnostics:async()=>({healthy:true}),update:async()=>{writes++;throw Object.assign(Error(),{code:'automation_settings_conflict'})},bulk:async()=>{writes++;return []}}
  const admin:any=(req:any,res:any,next:any)=>req.headers['x-test-admin']==='yes'?next():res.status(403).json({error:'forbidden'})
  const token='diagnostic-test-token-1234567890123456'
  registerLinkedInAutomationRoutes(app,admin,service,token)
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r))
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/admin/linkedin/automation`
  try{
    assert.equal((await fetch(`${url}/diagnostics`)).status,403)
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
    const read=await fetch(`${url}/diagnostics`,{headers});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store')
    assert.equal((await fetch(`${url}/bulk`,{method:'POST',headers,body:'{"items":[]}'})).status,403);assert.equal(writes,0)
    assert.equal((await fetch(`${url}?account=-1`,{headers})).status,400)
    assert.equal((await fetch(`${url}/1`,{method:'PUT',headers:{...headers,'x-test-admin':'yes'},body:'{}'})).status,409)
    assert.equal((await fetch(`${url}/diagnostics`,{headers:{Authorization:`Bearer ${'é'.repeat(token.length)}`}})).status,403)
  }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))}
})

test('startup failure is visible to admins while unrelated routes and access controls keep working',async()=>{
  const app=express();app.use(express.json())
  const admin:any=(req:any,res:any,next:any)=>req.headers['x-test-admin']==='yes'?next():res.sendStatus(403)
  registerLinkedInAutomationRoutes(app,admin,undefined,undefined,'automation_withdrawal_import_required')
  app.get('/unrelated',(_req,res)=>res.json({ok:true}))
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r))
  const base=`http://127.0.0.1:${(server.address() as any).port}`
  try {
    assert.equal((await fetch(`${base}/unrelated`)).status,200)
    assert.equal((await fetch(`${base}/api/admin/linkedin/automation`)).status,403)
    for(const path of ['', '/diagnostics']) {
      const response=await fetch(`${base}/api/admin/linkedin/automation${path}`,{headers:{'x-test-admin':'yes'}})
      assert.equal(response.status,503)
      const body=await response.json()
      assert.equal(body.error,'automation_withdrawal_import_required')
      assert.match(body.message,/Перенос журнала отзывов/)
    }
  } finally {await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))}
})

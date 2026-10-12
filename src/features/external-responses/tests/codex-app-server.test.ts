import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createCodexAppServer, safeRpcFailure } from '../infrastructure/codex-app-server.ts'

function fakeServer(handler: (message: any) => any) {
  const emitter = new EventEmitter() as any, stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
  emitter.stdin = stdin; emitter.stdout = stdout; emitter.stderr = stderr; emitter.kill = () => true; emitter.testStdout = stdout
  let pending = ''
  stdin.on('data', chunk => {
    pending += chunk.toString()
    for (;;) {
      const end = pending.indexOf('\n'); if (end < 0) break
      const line = pending.slice(0, end); pending = pending.slice(end + 1)
      const message = JSON.parse(line), response = handler(message)
      if (message.id !== undefined && response !== undefined) stdout.write(JSON.stringify({ id: message.id, ...response }) + '\n')
    }
  })
  return emitter
}

test('uses hidden stdio App Server, reads quota and interrupts only its registered owned turn', async () => {
  const messages: any[] = [], spawned: any[] = []
  const server = createCodexAppServer({ spawn: (exe, args, options) => {
    spawned.push({ exe, args, options })
    return fakeServer(message => {
      messages.push(message)
      if (message.method === 'initialize') return { result: {} }
      if (message.method === 'account/rateLimits/read') return { result: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 4 } } } } }
      if (message.method === 'thread/start') return { result: { thread: { id: 'thread-1' } } }
      if (message.method === 'turn/start') return { result: { turn: { id: 'turn-1' } } }
      if (message.method === 'turn/interrupt') return { result: {} }
    })
  } })
  try {
    const quota = await server.readPrimaryRateLimit()
    assert.equal(quota.rateLimitsByLimitId.codex.primary.usedPercent, 4)
    await assert.rejects(server.startOwnedTurn('owner-1', { threadId: 'thread-1', input: [] }), /owned_thread_mismatch/)
    const { ownedThread } = await server.startOwnedThread('owner-1')
    assert.equal(ownedThread.threadId, 'thread-1')
    const { ownedTurn } = await server.startOwnedTurn('owner-1', { threadId: ownedThread.threadId, input: [] })
    await assert.rejects(server.interruptOwnedTurn({ ...ownedTurn, ownerToken: 'owner-2' }), /owned_turn_mismatch/)
    assert.equal(messages.filter(message => message.method === 'turn/interrupt').length, 0)
    await server.interruptOwnedTurn(ownedTurn)
    assert.equal(messages.filter(message => message.method === 'turn/interrupt').length, 1)
    assert.deepEqual(spawned[0].args, ['app-server', '--listen', 'stdio://'])
    assert.deepEqual(spawned[0].options, { stdio: 'pipe', windowsHide: true })
    assert.deepEqual(messages.find(message => message.method === 'initialize').params, {
      clientInfo: { name: 'external_responses_budget', version: '1.0.0' }, capabilities: { experimentalApi: true } })
  } finally { await server.close() }
})

test('model catalog is metadata-only, paginated and cannot start a turn', async () => {
  const methods:string[]=[]
  const server=createCodexAppServer({spawn:()=>fakeServer(message=>{
    methods.push(message.method)
    if(message.method==='initialize')return {result:{}}
    if(message.method==='model/list')return {result:message.params.cursor?{data:[{model:'gpt-6.1-sol'}],nextCursor:null}:{data:[{model:'other'}],nextCursor:'page2'}}
  })})
  try {
    assert.deepEqual((await server.readModels()).map(m=>m.model),['other','gpt-6.1-sol'])
    assert.equal(methods.filter(m=>m==='model/list').length,2)
    assert.equal(methods.includes('turn/start'),false)
  }finally{await server.close()}
})

test('repeated catalog cursor fails instead of looping',async()=>{
  const server=createCodexAppServer({spawn:()=>fakeServer(message=>message.method==='initialize'?{result:{}}:{result:{data:[],nextCursor:'same'}})})
  try{await assert.rejects(server.readModels(),/pagination_invalid/)}finally{await server.close()}
})

test('maps authentication errors to a sanitized fail-closed error', async () => {
  const server = createCodexAppServer({ spawn: () => fakeServer(message => message.id === undefined ? undefined :
    message.method === 'initialize' ? { result: {} } : { error: { message: 'codex account authentication required for accountId private-123' } }) })
  try {
    await assert.rejects(server.readPrimaryRateLimit(), error => {
      assert.equal((error as Error).message, 'codex_app_server_auth_required')
      assert.equal((error as Error).message.includes('private-123'), false)
      return true
    })
  } finally { await server.close() }
})

test('quota RPC diagnostics retain transport category/code without leaking upstream credentials',async()=>{
  const server=createCodexAppServer({spawn:()=>fakeServer(m=>m.method==='initialize'?{result:{}}:{error:{code:-32603,message:'error sending request: HTTP status 503 https://private.test/?token=secret accountId private-123'}})})
  try{await assert.rejects(server.readPrimaryRateLimit(),error=>{const d=safeRpcFailure(error);assert.deepEqual(d,{category:'network',rpcCode:-32603,httpStatus:503,method:'account/rateLimits/read'});assert.doesNotMatch(JSON.stringify(error),/private|secret/);return true})}finally{await server.close()}
})
test('quota timeout is bounded independently and a late response cannot resolve its next request',async()=>{
  let child:any,lateId:number|undefined,reads=0
  const server=createCodexAppServer({quotaTimeoutMs:5,spawn:()=>child=fakeServer(m=>{if(m.method==='initialize')return {result:{}};if(m.method==='account/rateLimits/read'){if(++reads===1){lateId=m.id;return};child.testStdout.write(JSON.stringify({id:lateId,result:{wrong:true}})+'\n');return {result:{correct:true}}}})})
  try{await assert.rejects(server.readPrimaryRateLimit(),e=>safeRpcFailure(e).category==='timeout');assert.deepEqual(await server.readPrimaryRateLimit(),{correct:true})}finally{await server.close()}
})

test('forwards an early turn notification only for a thread created by this instance', async () => {
  const notifications: any[] = []
  let child: any
  const server = createCodexAppServer({ onNotification: notification => notifications.push(notification), spawn: () => {
    child = fakeServer(message => message.method === 'initialize' ? { result: {} }
      : message.method === 'thread/start' ? { result: { thread: { id: 'owned-thread' } } } : { result: {} })
    return child
  } })
  try {
    await server.startOwnedThread('owner-1')
    child.testStdout.write(JSON.stringify({ method: 'turn/started', params: { threadId: 'foreign-thread', turn: { id: 'foreign-turn' } } }) + '\n')
    child.testStdout.write(JSON.stringify({ method: 'turn/started', params: { threadId: 'owned-thread', turn: { id: 'early-turn' } } }) + '\n')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].params.turn.id, 'early-turn')
    assert.equal(notifications[0].ownedTurn, undefined)
  } finally { await server.close() }
})

const { startPostTestProcesses, waitPostHttp, POST_UI_PORT, POST_API_PORT } =
  require('./post-writer-processes.ts') as typeof import('./post-writer-processes.ts')
const demo = startPostTestProcesses()
let closing = false
function close() {
  if (closing) return
  closing = true
  demo.close()
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
demo.backend.once('exit', close)
demo.frontend.once('exit', close)
void Promise.all([waitPostHttp(`http://127.0.0.1:${POST_UI_PORT}`),
  waitPostHttp(`http://127.0.0.1:${POST_API_PORT}/api/auth/me`)]).then(() => {
  console.log(`Post Writer MOCK: http://127.0.0.1:${POST_UI_PORT}`)
  console.log('No external writes. Stop with Ctrl+C. Data lives in memory.')
}).catch(error => { console.error(error); process.exitCode = 1; close() })

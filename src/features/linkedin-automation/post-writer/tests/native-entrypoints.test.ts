import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

for (const loader of ['require','import']) {
  test(`Native ${loader} bootstrap uses the shared Noco limiter before a real transport call`, () => {
    const file = resolve('src/features/linkedin-automation/post-writer/noco-transport.ts')
    const load = loader === 'require' ? `require(${JSON.stringify(file)})` :
      `await import(${JSON.stringify(pathToFileURL(file).href)})`
    const code = `(async () => {
      const {createPostNocoTransport} = ${load};
      let calls = 0;
      const http = createPostNocoTransport(() => {}, async () => { calls++; return new Response('{}'); });
      await http.request('GET','/mock');
      if (calls !== 1) throw new Error('wrong_count');
    })().catch(error => { console.error(error); process.exitCode=1; })`
    const result = spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:10000,
      env:{...process.env,NOCODB_API_TOKEN:'mock-only',nocodb_api_token:'mock-only',NOCODB_BASE_URL:'http://127.0.0.1:1'}})
    assert.equal(result.status,0,result.stderr)
  })
}

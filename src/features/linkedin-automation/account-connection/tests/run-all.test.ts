const tests = [
  require('./profile-url.test.ts'),
  require('./session-cookie.test.ts'),
  require('./profile-lock.test.ts'),
  require('./dolphin-profile-proxy.test.ts'),
  require('./proxy-input.test.ts'),
  require('./proxy-recovery.test.ts'),
  require('./proxy.test.ts'),
  require('./cli-args.test.ts'),
  require('./noco-target.test.ts'),
  require('./session-collector.test.ts'),
  require('./unipile-adapter.test.ts'),
  require('./unipile-http.test.ts'),
  require('./account-validation.test.ts'),
  require('./auth-service-success.test.ts'),
  require('./auth-service-errors.test.ts')
] as Array<{ run(): Promise<void> }>

async function run(): Promise<void> {
  for (const test of tests) await test.run()
  console.log(`linkedin auth tests passed (${tests.length} suites)`)
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

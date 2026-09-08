import { startStandalone } from './standalone.ts'
void startStandalone().catch(() => {
  console.error('Standalone Writer startup failed; check local configuration.')
  process.exitCode = 1
})

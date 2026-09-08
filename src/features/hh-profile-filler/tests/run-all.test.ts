import { runStateStoreTests } from './state-store.test.ts'
import { runStackTitleTests } from './stack-titles.test.ts'
import { runProfileBuilderTests } from './profile-builder.test.ts'
import { runNocoRepositoryTests } from './noco-repository.test.ts'
import { runServiceTests } from './service.test.ts'
import { runProcessIsolationTests } from './process-isolation.test.ts'
import { runHHResumeUiTests } from './hh-resume-ui.test.ts'
import { runPendingRunnerTests } from './pending-runner.test.ts'

async function main() {
  runStateStoreTests()
  runStackTitleTests()
  runProfileBuilderTests()
  await runNocoRepositoryTests()
  await runServiceTests()
  await runHHResumeUiTests()
  runPendingRunnerTests()
  runProcessIsolationTests()
  console.log('HH profile filler tests passed.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

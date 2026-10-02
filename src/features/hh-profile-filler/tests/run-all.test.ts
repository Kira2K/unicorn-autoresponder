import { runStateStoreTests } from './state-store.test.ts'
import { runStackTitleTests } from './stack-titles.test.ts'
import { runProfileBuilderTests } from './profile-builder.test.ts'
import { runNocoRepositoryTests } from './noco-repository.test.ts'
import { runServiceTests } from './service.test.ts'
import { runProcessIsolationTests } from './process-isolation.test.ts'
import { runHHResumeUiTests } from './hh-resume-ui.test.ts'
import { runPendingRunnerTests } from './pending-runner.test.ts'
import { runPostgresRepositoryTests } from './postgres-repository.test.mts'
import { runPostgresWorkflowTests } from './postgres-workflow.test.mts'
import { runRepositoryRoutingTests } from './repository-routing.test.mts'
import { runPostgresExecutionTests } from './postgres-execution.test.mts'
import { runDriveSourceTests } from './drive-source.test.ts'
import { runEmployerStopListTests } from './employer-stop-list.test.ts'
import { runHHLiveDomTests } from './hh-live-dom.test.ts'
import { runLanguagePolicyTests } from './language-policy.test.ts'
import { runCvExtractorTests } from './cv-extractor.test.ts'
import { runStrictInvariantTests } from './strict-invariants.test.ts'
import { runContractDomTests } from './hh-contract-dom.test.ts'

async function main() {
  await runStrictInvariantTests()
  await runContractDomTests()
  runStateStoreTests()
  runStackTitleTests()
  runProfileBuilderTests()
  runLanguagePolicyTests()
  await runCvExtractorTests()
  await runNocoRepositoryTests()
  await runPostgresRepositoryTests()
  await runPostgresWorkflowTests()
  await runPostgresExecutionTests()
  runRepositoryRoutingTests()
  await runServiceTests()
  await runHHResumeUiTests()
  await runHHLiveDomTests()
  await runDriveSourceTests()
  await runEmployerStopListTests()
  runPendingRunnerTests()
  runProcessIsolationTests()
  console.log('HH profile filler tests passed.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

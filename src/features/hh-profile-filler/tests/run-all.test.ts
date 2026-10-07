import { runHHManualDomTests } from './hh-manual-dom.test.ts'
import { runEmployerStopListTests } from './employer-stop-list.test.ts'
import { runLanguagePolicyTests } from './language-policy.test.ts'
import { runCvExtractorTests } from './cv-extractor.test.ts'
import { runStrictInvariantTests } from './strict-invariants.test.ts'
import { runContractDomTests } from './hh-contract-dom.test.ts'
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
import { runHHLanguageTests } from './hh-languages.test.ts'
import { runHHEmployerTests } from './hh-employers.test.ts'
import { runHHCloneTests } from './hh-duplicate.test.ts'
import { runHHActivationTests } from './hh-activation.test.ts'
import { runSkillSelectionTests } from './skill-selection.test.ts'
import { runHHSkillsTests } from './hh-skills.test.ts'
import { runHHResumeLanguageTests } from './hh-resume-language.test.ts'
import { runHHJobSearchStatusTests } from './hh-job-search-status.test.ts'
import { runHHLiveDomTests } from './hh-live-dom.test.ts'

async function main() {
  await runStrictInvariantTests()
  await runContractDomTests()
  runLanguagePolicyTests()
  await runCvExtractorTests()
  await runEmployerStopListTests()
  runStateStoreTests()
  runStackTitleTests()
  runSkillSelectionTests()
  runProfileBuilderTests()
  await runNocoRepositoryTests()
  await runPostgresRepositoryTests()
  await runPostgresWorkflowTests()
  await runPostgresExecutionTests()
  runRepositoryRoutingTests()
  await runServiceTests()
  await runHHResumeUiTests()
  await runHHCloneTests()
  await runHHActivationTests()
  await runHHSkillsTests()
  await runHHResumeLanguageTests()
  await runHHJobSearchStatusTests()
  await runHHLiveDomTests()
  await runHHManualDomTests()
  await runHHLanguageTests()
  await runHHEmployerTests()
  await runDriveSourceTests()
  await runPendingRunnerTests()
  runProcessIsolationTests()
  console.log('HH profile filler tests passed.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

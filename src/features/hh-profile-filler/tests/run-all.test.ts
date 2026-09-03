import { runStateStoreTests } from './state-store.test.ts'
import { runStackTitleTests } from './stack-titles.test.ts'
import { runProfileBuilderTests } from './profile-builder.test.ts'
import { runNocoRepositoryTests } from './noco-repository.test.ts'
import { runServiceTests } from './service.test.ts'

async function main() {
  runStateStoreTests()
  runStackTitleTests()
  runProfileBuilderTests()
  await runNocoRepositoryTests()
  await runServiceTests()
  console.log('HH profile filler tests passed.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

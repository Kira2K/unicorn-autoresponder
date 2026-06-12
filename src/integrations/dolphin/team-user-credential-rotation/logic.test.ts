const { runTests } = require('./logic.ts') as {
  runTests(): Promise<void>
}

runTests()
  .then(() => {
    console.log('dolphin:user-credentials tests passed')
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })

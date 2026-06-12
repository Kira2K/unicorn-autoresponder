const orchestratorCli = require('./src/features/hh-responses/cli/orchestrator.ts')

if (require.main === module) {
  orchestratorCli.main()
}

module.exports = orchestratorCli

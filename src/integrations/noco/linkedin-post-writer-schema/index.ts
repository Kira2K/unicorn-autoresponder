const { ensurePostSchema } = require('./logic.ts') as typeof import('./logic.ts')
const { createPostNocoTransport } = require('../../../features/linkedin-automation/post-writer/noco-transport.ts') as typeof import('../../../features/linkedin-automation/post-writer/noco-transport.ts')
const { errorCode } = require('../../../features/linkedin-automation/post-writer/errors.ts') as typeof import('../../../features/linkedin-automation/post-writer/errors.ts')
if (require.main === module) {
  const apply = process.argv.includes('--apply')
  if (!apply && !process.argv.includes('--dry-run')) throw new Error('Specify --dry-run or --apply')
  ensurePostSchema(createPostNocoTransport(() => undefined), apply)
    .then(result => console.log(JSON.stringify({ apply, tables: result }, null, 2)))
    .catch(error => { console.error(errorCode(error)); process.exitCode = 1 })
}

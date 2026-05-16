// Browser-side auto-responder facade. The orchestrator should depend on this
// surface, while control/storage/log parsing stay split underneath.
module.exports = {
  ...require('./control.ts'),
  ...require('./counter.ts'),
  ...require('./inject.ts'),
  ...require('./parser-logs.ts'),
  ...require('./storage.ts')
}

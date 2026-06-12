// Dolphin facade: keep orchestrator imports pointed here so Dolphin internals
// can move without making the main runner expensive to reread.
module.exports = {
  ...require('./locks.ts'),
  ...require('./preflight.ts'),
  ...require('./profiles.ts'),
  ...require('./runtime.ts')
}

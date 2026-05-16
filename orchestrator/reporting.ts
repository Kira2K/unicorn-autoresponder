// Reporting facade kept so the runner does not need to know the internal
// Telegram report module layout.
module.exports = {
  ...require('./telegram-reporting.ts')
}

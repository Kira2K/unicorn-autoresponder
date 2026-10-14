// Old snapshots omit browser; an explicit unknown provider must never become Dolphin.
function isDolphinProfile(row: Record<string, unknown>): boolean {
  return row.browser === undefined || row.browser === 'dolphin'
}

module.exports = { isDolphinProfile }

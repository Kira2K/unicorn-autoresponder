function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    return require('C:/Users/kiras/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
  }
}

module.exports = {
  loadPlaywright
}

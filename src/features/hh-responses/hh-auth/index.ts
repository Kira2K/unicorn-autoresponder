const { hhAuthSelectors } = require('./auth-selectors.ts')
const { authorizeHHPage, makeHHAuth, HHAuthError } = require('./make-hh-auth.ts')
const {
  closeBrowser,
  collectDataQa,
  selectorExists,
  takeScreenshot
} = require('./utils/index.ts')
const { validateAuth } = require('./validate-auth.ts')

module.exports = {
  HHAuthError,
  authorizeHHPage,
  closeBrowser,
  collectDataQa,
  hhAuthSelectors,
  makeHHAuth,
  selectorExists,
  takeScreenshot,
  validateAuth
}

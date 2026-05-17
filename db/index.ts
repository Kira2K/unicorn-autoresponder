const { createGoogleSheetsDb } = require('./google-sheets-db.ts') as {
  createGoogleSheetsDb(): import('./types.ts').AppDb
}

function createAppDb(): import('./types.ts').AppDb {
  return createGoogleSheetsDb()
}

module.exports = {
  createAppDb
}

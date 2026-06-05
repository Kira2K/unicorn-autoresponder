const { createGoogleSheetsDb } = require('./google-sheets-db.ts') as {
  createGoogleSheetsDb(): import('./types.ts').AppDb
}
const { createNocoDb } = require('./noco/noco-db.ts') as {
  createNocoDb(): import('./types.ts').AppDb
}

function createAppDb(): import('./types.ts').AppDb {
  if (String(process.env.APP_DB ?? '').trim().toLowerCase() === 'noco') {
    return createNocoDb()
  }

  return createGoogleSheetsDb()
}

module.exports = {
  createAppDb,
  createGoogleSheetsDb,
  createNocoDb
}

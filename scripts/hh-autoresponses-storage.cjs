// Resolve only storage; never print or export credentials from .env.
function resolveStorage(env = process.env, cwd = process.cwd()) {
  const fs = require('node:fs');
  const path = require('node:path');
  const dotenv = require('dotenv');
  const file = path.join(cwd, '.env');
  const configured = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)).APP_DB : '';
  const mode = String(env.APP_DB || configured || 'postgres').trim().toLowerCase();
  if (!['noco', 'postgres'].includes(mode)) throw new Error('HH autoresponses APP_DB must be noco or postgres');
  return mode;
}
module.exports = { resolveStorage };
if (require.main === module) {
  try { console.log(resolveStorage()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

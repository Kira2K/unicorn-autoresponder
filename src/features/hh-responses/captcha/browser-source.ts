const fs = require('node:fs')
const path = require('node:path')
function createCaptchaBrowserSource(): string {
  return fs.readFileSync(path.join(__dirname, 'browser-runtime.js'), 'utf8')
}
module.exports = { createCaptchaBrowserSource }

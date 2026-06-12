const fs = require('node:fs')
const path = require('node:path')

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function createReportDir(jobName: string): string {
  const baseDir = path.join(process.cwd(), 'logs', jobName)
  const dir = path.join(baseDir, createTimestamp())
  ensureDir(dir)
  fs.writeFileSync(path.join(baseDir, 'latest.txt'), `${dir}\n`, 'utf8')
  return dir
}

function writeJson(dir: string, fileName: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, fileName), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function writeText(dir: string, fileName: string, content: string): void {
  fs.writeFileSync(path.join(dir, fileName), content, 'utf8')
}

module.exports = {
  createReportDir,
  createTimestamp,
  ensureDir,
  writeJson,
  writeText
}

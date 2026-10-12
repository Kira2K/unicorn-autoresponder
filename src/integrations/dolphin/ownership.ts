const fs = require('node:fs') as typeof import('node:fs')
const path = require('node:path') as typeof import('node:path')
const { randomUUID } = require('node:crypto') as typeof import('node:crypto')
const owned = new Map<number, string>()
const directory = () => path.resolve(process.env.DOLPHIN_LEASE_DIRECTORY || 'storage/dolphin-ownership')
function leasePath(profileId: number) {
  if (!Number.isSafeInteger(profileId) || profileId <= 0) throw Error('invalid_dolphin_profile_id')
  return path.join(directory(), `${profileId}.json`)
}
function assertDolphinOwnership(profileId: number): void {
  let record: any
  try { record = JSON.parse(fs.readFileSync(leasePath(profileId), 'utf8')) } catch (e: any) { if (e.code === 'ENOENT') return; throw e }
  if (record.token !== owned.get(profileId)) throw Error(`dolphin_profile_owned:${profileId}:pid=${record.pid}. Reconcile ownership before retrying.`)
}
function acquireDolphinOwnership(profileId: number, owner = 'dolphin-runtime') {
  if (owned.has(profileId)) throw Error(`dolphin_profile_already_owned:${profileId}`)
  fs.mkdirSync(directory(), { recursive: true })
  const token = randomUUID(), file = fs.openSync(leasePath(profileId), 'wx', 0o600)
  try { fs.writeFileSync(file, JSON.stringify({ profileId, token, pid: process.pid, owner, acquiredAt: new Date().toISOString() })); fs.fsyncSync(file) } finally { fs.closeSync(file) }
  owned.set(profileId, token)
}
function releaseDolphinOwnership(profileId: number) {
  if (!owned.has(profileId)) return
  assertDolphinOwnership(profileId); fs.unlinkSync(leasePath(profileId)); owned.delete(profileId)
}
module.exports = { acquireDolphinOwnership, assertDolphinOwnership, releaseDolphinOwnership }

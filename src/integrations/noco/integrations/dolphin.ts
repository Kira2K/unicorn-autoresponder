const {
  getAllDolphinProfileSnapshots
} = require('../../dolphin/proxyProvider/checkRequiredProxy/dolphin-api.ts') as {
  getAllDolphinProfileSnapshots(): Promise<Array<Record<string, unknown>>>
}
const {
  addDolphinProfileTag,
  getDolphinProfile
} = require('../../dolphin/profiles.ts') as {
  addDolphinProfileTag(profileId: number, tag: string): Promise<void>
  getDolphinProfile(profileId: number): Promise<{ tags?: string[] }>
}
const {
  getDolphinProfileNameCandidates
} = require('../../dolphin/proxyProvider/checkRequiredProxy/logic.ts') as {
  getDolphinProfileNameCandidates(client: {
    firstName: string
    secondName: string
    stack: string
  }, market: 'Ru' | 'En'): Array<{ format: string; name: string }>
}

async function fetchDolphinProfileInventory(): Promise<Array<Record<string, unknown>>> {
  return getAllDolphinProfileSnapshots()
}

async function fetchDolphinProfileDetails(profileId: number): Promise<{ tags?: string[] }> {
  return getDolphinProfile(profileId)
}

async function addBindingTag(profileId: number, tag: string): Promise<void> {
  await addDolphinProfileTag(profileId, tag)
}

module.exports = {
  addBindingTag,
  fetchDolphinProfileDetails,
  fetchDolphinProfileInventory,
  getDolphinProfileNameCandidates
}

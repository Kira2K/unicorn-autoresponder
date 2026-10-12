import { createDolphinBrowser } from '../infrastructure/dolphin-browser.ts'

/** Busy is scheduling state, not a failed application. Only classify browser acquisition errors. */
export async function openApplicationBrowser(input: Parameters<typeof createDolphinBrowser>[0], open = createDolphinBrowser) {
  try { return { status: 'available' as const, context: await open(input) } }
  catch (error: any) {
    if (!/^dolphin_profile_(busy|owned|already_owned)(?:$|:)/.test(String(error?.message))) throw error
    return { status: 'busy' as const, reason: 'profile_busy', profileId: input.profileId,
      nextAction: 'Resume the same targets after the profile is free; do not take over or stop it.' }
  }
}

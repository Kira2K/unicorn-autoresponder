import type { Locator, Page } from 'playwright'
import { profileFillerError } from './errors.ts'

export async function dismissStaleResumeContactsPrompt(page: Page): Promise<boolean> {
  const notice = page.locator('[data-qa="profile-contacts-sync-alert"]:visible, ' +
    '[role="dialog"]:visible, [role="alertdialog"]:visible, [class*="magritte-overlay"]:visible')
    .filter({ hasText: /Контакты\s+в\s+резюме\s+могли\s+устареть|Resume\s+contacts\s+may\s+be\s+out\s+of\s+date/i }).first()
  if (!(await notice.isVisible())) return false
  const close = notice.getByRole('button', { name: /^(?:Закрыть|Close)$/i })
  if (await close.count() !== 1) throw profileFillerError('profile_hh_stale_contacts_prompt_blocked',
    'HH stale-resume-contacts prompt has no unique Close control.', 'open_profile')
  // Never replace verified resume contacts with values from the general profile.
  await close.click({ timeout: 5_000 })
  await notice.waitFor({ state: 'hidden', timeout: 5_000 })
  return true
}

export async function clickAfterDismissingStaleContacts(page: Page, control: Locator, timeout = 30_000): Promise<void> {
  await dismissStaleResumeContactsPrompt(page)
  try {
    await control.click({ timeout })
  } catch (error) {
    // The notice can arrive after the control becomes visible. Retry only after
    // observing and dismissing that known notice; never force through a dialog.
    if (!(await dismissStaleResumeContactsPrompt(page))) throw error
    await control.click()
  }
}

import type { Page } from 'playwright'

export async function openLinkedInManual(page: Page, account: number, section?: 'invitations' | 'comments') {
  await page.getByTestId('linkedin-students-view').click()
  await page.getByTestId(`linkedin-open-${account}`).click()
  await page.getByTestId('linkedin-manual-tab').click()
  if (section) {
    const details = page.getByTestId(`linkedin-manual-${account}`).getByTestId(`manual-${section}`)
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
  }
}

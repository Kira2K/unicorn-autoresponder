import type { Page } from 'playwright'

/** Existing feature scenarios enter through the student's new detail card. */
export async function openLinkedInManual(page: Page, id = 203, connection = false) {
  await page.getByTestId(`linkedin-student-${id}`).click()
  await page.getByTestId('linkedin-detail-manual').click()
  if (connection) {
    const section = page.getByTestId('linkedin-manual').locator('details').filter({ has: page.locator('summary', { hasText: 'Подключение и профиль' }) })
    if (!await section.evaluate(node => (node as HTMLDetailsElement).open)) await section.locator('summary').first().click()
  }
}

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import type { Page } from 'playwright'

export async function checkProfileLayout(page: Page) {
  await mkdir('logs/profile-filler-ui', { recursive: true })
  for (const [width, height, zoom] of [[1366, 768, 1], [1920, 1080, 1], [1366, 768, 1.25]]) {
    // Chromium page zoom reduces the CSS viewport by the same factor.
    await page.setViewportSize({ width: Math.floor(width / zoom), height: Math.floor(height / zoom) })
    const dialog = page.locator('.profile-filler-dialog')
    const box = await dialog.boundingBox()
    assert(box && box.width <= 1281 && box.x >= 0 && box.y >= 0)
    const footer = page.getByTestId('profile-filler-footer')
    const footerBox = await footer.boundingBox()
    assert(footerBox && footerBox.y + footerBox.height <= Math.floor(height / zoom))
    const main = dialog.locator('.profile-main')
    await main.evaluate(element => { element.scrollTop = element.scrollHeight })
    assert.deepEqual(await footer.boundingBox(), footerBox, 'footer stays fixed while scrolling')
    assert(await main.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    await main.evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: `logs/profile-filler-ui/preview-${width}-${zoom}.png` })
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  const apply = page.getByTestId('profile-filler-apply')
  await apply.focus()
  assert(await apply.evaluate(element => element === document.activeElement))
  await page.keyboard.press('Enter')
  await page.getByTestId('profile-confirm-submit').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.profile-confirmation').waitFor({ state: 'hidden' })
  await page.waitForTimeout(250)
  await page.locator('.profile-filler-dialog').waitFor()
}

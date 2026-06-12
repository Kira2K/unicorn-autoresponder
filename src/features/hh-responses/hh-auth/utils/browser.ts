const fs = require('node:fs/promises')
const path = require('node:path')

async function takeScreenshot(
  page: any,
  artifactDir: string | undefined,
  fileName: string
): Promise<string | undefined> {
  if (!artifactDir) {
    return undefined
  }

  await fs.mkdir(artifactDir, { recursive: true })
  const screenshotPath = path.join(artifactDir, fileName)
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
    timeout: 15000
  })

  return screenshotPath
}

async function closeBrowser(browser: any): Promise<void> {
  await browser?.close?.().catch(() => undefined)
}

async function selectorExists(page: any, selector: string, timeoutMs = 3000): Promise<boolean> {
  if (!selector) {
    return false
  }

  try {
    await page.locator(selector).first().waitFor({
      state: 'attached',
      timeout: timeoutMs
    })

    return true
  } catch {
    return false
  }
}

async function collectDataQa(page: any): Promise<string[]> {
  try {
    return await page.evaluate(() => Array.from(document.querySelectorAll('[data-qa]'))
      .map((item) => item.getAttribute('data-qa') || '')
      .filter(Boolean)
      .slice(0, 200))
  } catch {
    return []
  }
}

module.exports = {
  closeBrowser,
  collectDataQa,
  selectorExists,
  takeScreenshot
}

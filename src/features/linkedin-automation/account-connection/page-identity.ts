async function readLinkedInPageIdentity(page: any) {
  await page.waitForFunction?.(() => {
    const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href
    const social = (document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null)?.content
    return [canonical, social, location.href].some(value =>
      /linkedin\.com\/in\/(?!me(?:\/|$))[^/?#]+/i.test(String(value ?? ''))
    )
  }, undefined, { timeout: 15_000 }).catch(() => undefined)

  return await page.evaluate(() => {
    const canonical = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href
    const social = (document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null)?.content
    const profileUrl = [canonical, social, location.href].find(value =>
      /linkedin\.com\/in\/(?!me(?:\/|$))[^/?#]+/i.test(String(value ?? ''))
    ) ?? location.href
    return { profileUrl, userAgent: navigator.userAgent }
  })
}

module.exports = { readLinkedInPageIdentity }

import type { Page } from 'playwright'

/** Dismiss only a recognized cookie banner using its reject/necessary-only control. */
export async function dismissCookieBanner(page: Page): Promise<boolean> {
  const banners=page.locator('#usercentrics-cmp-ui, #onetrust-banner-sdk, [id*="cookie" i], [class*="cookie-banner" i], [data-testid="uc-default-wall"]')
  const buttons=banners.getByRole('button',{name:/^(?:reject all(?: cookies)?|deny all|decline all|only necessary(?: cookies)?|necessary cookies only|reject optional cookies)$/i})
  for(let i=0;i<Math.min(await buttons.count(),6);i++) {
    const button=buttons.nth(i)
    if(!await button.isVisible().catch(()=>false))continue
    if(await button.evaluate(el=>!!el.closest('form')))continue
    try {await button.click({timeout:1500});return true}catch{return false}
  }
  return false
}

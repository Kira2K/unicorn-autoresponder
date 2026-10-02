import type { BrowserContext, Page } from 'playwright'
import { ProfileFillerError } from './errors.ts'

const failures = new WeakMap<BrowserContext, ProfileFillerError>()

function watcherSource(): string {
  return `(() => {
    if (window.__hhCookieConsentWatcherInstalled) return;
    const install = () => {
      if (window.__hhCookieConsentWatcherInstalled) return;
      if (!document.documentElement) { setTimeout(install, 0); return; }
      window.__hhCookieConsentWatcherInstalled = true;
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const inspect = () => {
        const explicit = document.querySelector('[data-qa="cookies-policy-informer-accept"]');
        if (explicit && visible(explicit)) { explicit.click(); return; }
        const containers = Array.from(document.querySelectorAll('aside,[role="dialog"]'));
        for (const container of containers) {
          if (!visible(container) || !/cookie|куки|cookies/i.test(container.textContent || '')) continue;
          const accept = Array.from(container.querySelectorAll('button,a')).find(control =>
            /^(понятно|принять|accept|allow all)$/i.test((control.textContent || '').trim()));
          if (accept && visible(accept)) { accept.click(); return; }
          window.__hhCookieConsentBlocked?.();
        }
      };
      new MutationObserver(inspect).observe(document.documentElement,
        { subtree: true, childList: true, attributes: true, attributeFilter: ['style','class'] });
      document.addEventListener('pointerover', inspect, true);
      document.addEventListener('click', inspect, true);
      setInterval(inspect, 250);
      inspect();
    };
    install();
  })()`
}

async function installOnPage(page: Page): Promise<void> {
  await page.evaluate(watcherSource()).catch(() => undefined)
}

export async function installHhCookieConsentHandler(page: Page): Promise<void> {
  await installOnPage(page)
}

export async function installHhCookieConsentForContext(context: BrowserContext): Promise<void> {
  await context.exposeBinding('__hhCookieConsentBlocked', () => {
    failures.set(context, new ProfileFillerError('profile_hh_cookie_consent_blocked',
      'HH cookie consent notice blocks the requested control and has no accept action.',
      'open_hh'))
  }).catch(() => undefined)
  await context.addInitScript(watcherSource())
  for (const page of context.pages()) await installOnPage(page)
  context.on('page', page => { void installOnPage(page) })
}

export function hhCookieConsentFailure(context: BrowserContext): ProfileFillerError | undefined {
  return failures.get(context)
}

declare global {
  interface Window {
    __hhCookieConsentWatcherInstalled?: boolean
    __hhCookieConsentBlocked?: () => void
  }
}

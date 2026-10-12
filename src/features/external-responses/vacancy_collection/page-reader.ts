import type { BrowserContext } from 'playwright'
import { readAts } from './ats-reader.ts'
import { readPublicPlatform } from './public-platform-reader.ts'
import { readPublicBoard } from './public-board-reader.ts'
import { readWorkable } from './workable-reader.ts'
import { isLinkedInUrl } from '../infrastructure/navigation-policy.ts'
import type { PageReader, PageDocument, SourceAccessGate, PageReadOptions } from '../types.ts'
import type { ControlStep } from './source-memory.ts'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { vacancyLinks } from './navigation.ts'
import { installPopupLinks } from './popup-links.ts'
import { readPostingPdf } from './pdf-reader.ts'
import { dismissCookieBanner } from './cookie-banner.ts'
const jobSearchSelector = 'input[placeholder*="Search jobs" i], input[placeholder*="Search roles" i], input[aria-label*="Search jobs" i], input[aria-label*="Search roles" i]'
const sensitiveQuery=/(?:^|[-_])(?:token|tk|csrf|xsrf|nonce|captcha)(?:$|[-_])|^(?:auth(?:orization)?|api[-_]?key|key|secret|session|state|signature|sig|jwt|code|password)$/i
const trackingQuery=/^(?:utm_.+|gclid|fbclid|_ga|_gl)$/i
function observedListingUrl(value:string) {
  try {
    const url=new URL(value);url.username='';url.password='';url.hash=''
    for(const key of [...url.searchParams.keys()])if(sensitiveQuery.test(key)||trackingQuery.test(key))url.searchParams.delete(key)
    return url.href.slice(0,1200)
  } catch { return undefined }
}

export function createPageReader(options: { context: BrowserContext; fetchImpl?: typeof fetch; minIntervalMs?: number; onPage?: (page: PageDocument) => Promise<void>; excludedHosts?: string[]; evidenceDirectory?:string }): PageReader {
  const excluded = (value: string) => isLinkedInUrl(value) || (options.excludedHosts ?? []).some(host => new URL(value).hostname === host || new URL(value).hostname.endsWith('.' + host))
  const hosts = new Map<string, Promise<unknown>>()
  const apiHosts = new Map<string, Promise<unknown>>()
  const pacedFetch: typeof fetch = async (input, init) => {
    const host = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url).hostname
    if (excluded(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)) throw Error('Source host excluded from this discovery run')
    // Public ATS endpoints have stable URLs. Never follow an unchecked HTTP redirect.
    const next = (apiHosts.get(host) ?? Promise.resolve()).catch(() => {}).then(async () => { await new Promise(r => setTimeout(r, options.minIntervalMs ?? 500)); return (options.fetchImpl ?? fetch)(input, {...init,redirect:'error'}) })
    apiHosts.set(host, next); return next
  }
  async function read(url: string, request: PageReadOptions = {}): Promise<PageDocument> {
    const controls: ControlStep[] = []
    const action = async (operation: string, target = url, step?: ControlStep) => { await request.onAction?.({operation,url:target,at:new Date().toISOString(),outcome:'ok',...(step?{step}:{})}) }
    if (excluded(url)) throw Error('Source host excluded from this discovery run')
    if (request.steps && request.steps.length > 32) throw Error('recipe_control_budget_exceeded')
    const host = new URL(url).hostname, previous = hosts.get(host) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(async ():Promise<PageDocument> => {
      await new Promise(r => setTimeout(r, options.minIntervalMs ?? 500))
      const pdf=await readPostingPdf(url,pacedFetch)
      if(pdf){await action('read_public_pdf');return {...pdf,controls}}
      const ats = await readAts(url, pacedFetch,request.previous).catch(() => undefined)
      if (ats) { await action('read_public_ats'); return { ...ats, controls } }
      const platform = await readPublicPlatform(url, pacedFetch)
      if (platform) { await action('read_public_platform'); return { ...platform, controls } }
      const board = await readPublicBoard(url, pacedFetch)
      if (board) { await action('read_public_board'); return { ...board, controls } }
      const workable = await readWorkable(url, pacedFetch)
      if (workable) { await action('read_public_workable'); return { ...workable, controls } }
      const page = await options.context.newPage()
      // Routing alone does not intercept every hop of an HTTP redirect chain.
      // Chromium's network block applies before the redirected request is sent.
      const network = await options.context.newCDPSession(page)
      const popupLinks=await installPopupLinks(page,network)
      const blockedDomains = ['linkedin.com','lnkd.in',...(options.excludedHosts ?? [])]
      await network.send('Network.enable')
      await network.send('Network.setBypassServiceWorker',{bypass:true})
      await network.send('Network.setBlockedURLs',{urls:blockedDomains.flatMap(host=>[
        `*://${host}/*`,`*://${host}:*/*`,`*://*.${host}/*`,`*://${host}./*`,`*://*.${host}./*`
      ])})
      let forbiddenNavigation = false
      page.on('request',request=>{if(excluded(request.url()) && request.isNavigationRequest())forbiddenNavigation=true})
      const captureFailure=async()=>{
        if(!options.evidenceDirectory)return
        let evidenceRef:string
        try {await mkdir(options.evidenceDirectory,{recursive:true});evidenceRef=join(options.evidenceDirectory,createHash('sha256').update(url).digest('hex').slice(0,16)+'-'+Date.now()+'.png');await page.screenshot({path:evidenceRef,timeout:5000})}catch{return}
        await request.onAction?.({operation:'failure_screenshot',url:page.url(),at:new Date().toISOString(),outcome:'ok',evidenceRef})
      }
      await page.route('**/*', route => excluded(route.request().url()) ? route.abort() : route.fallback())
      // Inspect every redirect response, including hops hidden from Playwright routing.
      network.on('Fetch.requestPaused',event=>{
        const location=event.responseHeaders?.find(header=>header.name.toLowerCase()==='location')?.value
        const blocked=excluded(event.request.url)||(location && event.responseStatusCode && event.responseStatusCode>=300 && event.responseStatusCode<400 && excluded(new URL(location,event.request.url).href))
        if(blocked)forbiddenNavigation=true
        void network.send(blocked?'Fetch.failRequest':'Fetch.continueRequest',blocked?{requestId:event.requestId,errorReason:'BlockedByClient'}:{requestId:event.requestId}).catch(()=>{})
      })
      await network.send('Fetch.enable',{patterns:[{urlPattern:'*',resourceType:'Document',requestStage:'Response'}]})
      const boardUrls = new Set<string>(), listingRequests = new Map<string,{url:string;method:string;resourceType:string}>(), entryHost=new URL(url).hostname
      page.on('request', request => {
        const u = new URL(request.url())
        const gh = u.hostname === 'boards-api.greenhouse.io' ? u.pathname.match(/\/boards\/([^/]+)/)?.[1]
          : /^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io$/.test(u.hostname)&&u.pathname.startsWith('/embed/')&&/^[a-zA-Z0-9_-]+$/.test(u.searchParams.get('for')??'') ? u.searchParams.get('for') : undefined
        const ashby = u.hostname === 'api.ashbyhq.com' && u.pathname.match(/\/job-board\/([^/]+)/)?.[1]
        const lever = /^api\.(eu\.)?lever\.co$/.test(u.hostname) && u.pathname.match(/\/postings\/([^/]+)/)?.[1]
        const smartRecruiters = u.hostname === 'api.smartrecruiters.com' && u.pathname.match(/^\/v1\/companies\/([^/]+)\/postings/)?.[1]
        if (gh) boardUrls.add(`https://job-boards.greenhouse.io/${gh}`)
        if (ashby) boardUrls.add(`https://jobs.ashbyhq.com/${ashby}`)
        if (lever) boardUrls.add(`https://jobs.${u.hostname.includes('.eu.') ? 'eu.' : ''}lever.co/${lever}`)
        if (smartRecruiters) boardUrls.add(`https://jobs.smartrecruiters.com/${smartRecruiters}`)
        if (/^(?!www\.|support\.|help\.|api\.|app\.)[a-z0-9-]+\.bamboohr\.com$/i.test(u.hostname) && /^\/(?:jobs\/embed\d*\.php|careers(?:\/list)?\/?|js\/embed\.js)$/i.test(u.pathname)) boardUrls.add(u.origin+'/careers')
        const ats=/greenhouse|ashbyhq|lever\.co|recruitee|workable|smartrecruiters|teamtailor|pinpointhq|sage\.hr/i.test(u.hostname)
        const listing=/jobs?|careers?|positions?|vacanc|openings?|requisitions?|postings?|search|api/i.test(u.pathname+' '+u.search)
        const resourceType=request.resourceType()
        if(listingRequests.size<40&&(u.hostname===entryHost||ats)&&listing&&['document','xhr','fetch','script'].includes(resourceType)){
          const sanitized=observedListingUrl(u.href)
          if(sanitized)listingRequests.set(request.method()+' '+sanitized,{url:sanitized,method:request.method(),resourceType})
        }
      })
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 })
        if (forbiddenNavigation || excluded(page.url())) throw Error('source_redirect_forbidden')
        await action('navigate',page.url())
        if (response && [404,410].includes(response.status())) return { url:page.url(),text:'Posting unavailable',jobs:[],links:[],closedEvidence:`Official URL returned HTTP ${response.status()}`,method:'browser',controls }
        const barrier = await page.evaluate(() => {
          const text=document.body.innerText, heading=[document.title,...[...document.querySelectorAll('h1,h2,[role="dialog"]')].filter(e=>e.getClientRects().length).map(e=>e.textContent??'')].join('\n')
          const challenge=/^(?:verify (?:you are|that you are) (?:a )?human|checking your browser|just a moment|access denied|unusual traffic|complete the (?:captcha|security check)|are you (?:a )?(?:human|robot))[.!?\s]*$/im
          const ui=[...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenges.cloudflare.com"],[class~="g-recaptcha"],[class~="h-captcha"],#challenge-running')].some(e=>e.getClientRects().length)
          const wall=challenge.test(heading)||(ui&&text.length<1500&&/verify|security check|captcha/i.test(text))
          return wall?{text,evidence:heading.slice(0,300),captcha:ui||/verify|captcha|human|robot/i.test(heading)}:undefined
        })
        if (barrier) { await captureFailure();return {url:page.url(),text:barrier.text.slice(0,1000),jobs:[],links:[],accessGate:{kind:barrier.captcha?'captcha_required':'robot_rejected',url:page.url(),evidence:barrier.evidence},method:'browser',controls} }
        if (response && response.status() >= 400) throw Error(`HTTP ${response.status()}`)
        await page.waitForTimeout(1200)
        if(await dismissCookieBanner(page))await action('dismiss_cookie_banner',page.url())
        if (request.steps) for (const step of request.steps) {
          if (step.operation === 'clear_search') {
            if (step.selector !== jobSearchSelector) throw Error('recipe_selector_not_allowed')
            const search = page.locator(step.selector).first(); await search.fill(''); await search.press('Enter')
          } else if (step.operation === 'fill_search') {
            if (!step.selector || !step.value?.trim() || step.value.length > 100 || step.role || step.name) throw Error('recipe_search_fill_not_allowed')
            const search = page.locator(step.selector).first()
            if (!(await search.isVisible().catch(() => false))) throw Error('recipe_search_fill_not_visible')
            const safe = await search.evaluate(element => {
              if (!(element instanceof HTMLInputElement) || !['text', 'search'].includes(element.type || 'text')) return false
              const semantics = [element.id, element.name, element.placeholder, element.getAttribute('aria-label'), element.className].join(' ')
              if (!/(?:job|role|position|vacanc|career|keyword|search|ваканс|должност|ключ)/i.test(semantics) || /(?:location|city|address|email|phone|contact|name|локац|город|адрес|почт|телефон)/i.test(semantics)) return false
              const form = element.closest('form')
              if (!form) return true
              const action = form.getAttribute('action') ?? ''
              const sensitive = form.querySelector('input[type="file"],input[type="password"],input[type="email"],input[type="tel"],textarea,[name*="resume" i],[name*="cv" i],[name*="contact" i],[name*="message" i]')
              const applicationControl = [...form.querySelectorAll('button,input[type="submit"],a[href]')].some(control => /(?:apply|submit application|send application|register|sign.?in|log.?in|отклик)/i.test([control.textContent,control.getAttribute('aria-label'),control.getAttribute('name'),control.getAttribute('href')].join(' ')))
              if (sensitive || applicationControl || /(?:apply|application|register|sign.?in|log.?in|contact|resume|curriculum|submit-cv|отклик)/i.test(action)) return false
              return /(?:job|role|position|vacanc|career|search|ваканс|должност)/i.test([form.textContent,action].join(' ')) || !action
            })
            if (!safe) throw Error('recipe_search_fill_not_allowed')
            await search.fill(step.value.trim()); await search.press('Enter'); await page.waitForTimeout(900)
          } else {
            if (step.operation!=='click' || (!step.selector && (!step.role || !['button','link'].includes(step.role) || !step.name)) || /apply|submit|send|register|sign.?in|log.?in|отклик/i.test(step.name??'')) throw Error('recipe_control_not_allowed')
            const control = step.selector ? page.locator(step.selector).first() : page.getByRole(step.role!,{name:step.name,exact:true}).first()
            const forbidden=await control.evaluate(el=>!!el.closest('form') || el.tagName==='INPUT' || /apply|submit|send|register|sign.?in|log.?in|отклик/i.test([el.textContent,el.getAttribute('aria-label'),el.getAttribute('href')].join(' ')))
            if(forbidden)throw Error('recipe_control_not_allowed')
            const before={url:page.url(),text:await page.locator('body').innerText(),popups:(await popupLinks.links()).length}
            await popupLinks.label((await control.innerText()).trim().split('\n')[0])
            await control.click({timeout:5000})
            // Async download imports must settle before the next card changes the
            // evidence label. A fixed sleep can lose or mislabel the last PDF.
            await page.waitForFunction(before=>location.href!==before.url||document.body.innerText!==before.text||JSON.parse(document.documentElement.getAttribute('data-collection-popup-links')??'[]').length>before.popups,before,{timeout:5000}).catch(()=>{throw Error('recipe_control_no_observed_effect')})
            await popupLinks.label(''); await page.waitForTimeout(200)
          }
          controls.push(step); await action(step.operation,page.url(),step)
        }
        let incompleteControls=false
        const openings = page.getByRole('link', { name: /^(view job openings|see (?:our )?open positions|see (?:our )?open roles|view open roles)$/i }).first()
        if (await openings.isVisible().catch(() => false)) {
          const href = await openings.getAttribute('href')
          if (!request.steps && (href?.startsWith('#') || href?.includes('/#'))) {
            const step: ControlStep={operation:'click',role:'link',name:(await openings.innerText()).trim()}
            try {await openings.click({timeout:3000});controls.push(step);await action('click',page.url(),step);await page.waitForTimeout(1200)}
            catch {incompleteControls=true;await request.onAction?.({operation:'listing_anchor_unavailable',url:page.url(),at:new Date().toISOString(),outcome:'failed',detail:'Listing anchor blocked; preserve visible listings as partial'})}
          }
        }
        // Shared collection must keep all roles, including non-engineering stacks.
        // Public search controls only. Never interact with an application/contact form here.
        const search = page.locator(jobSearchSelector).first()
        if (!request.steps && await search.isVisible().catch(() => false) && (await search.inputValue()).trim()) { await search.fill(''); await search.press('Enter'); const step:ControlStep={operation:'clear_search',selector:jobSearchSelector}; controls.push(step); await action('clear_search',page.url(),step); await page.waitForTimeout(900) }
        for (let i = 0; !request.steps && i < 16; i++) {
          const more = page.getByRole('button', { name: /^(load more|show more jobs|view more jobs|show all open positions)$/i }).first()
          if (!(await more.isVisible().catch(() => false))) break
          if (!(await more.isEnabled())) break
          const listingControl=await more.evaluate(button=>{
            if(button.closest('form'))return false
            if(/jobs|open positions/i.test(button.textContent??''))return true
            const section=button.closest('section,article')??button.parentElement
            return !!section && (/(?:jobs?|positions?|vacancies|engineer|developer)/i.test([...section.querySelectorAll('h1,h2,h3')].map(h=>h.textContent).join(' ')) || !!section.querySelector('a[href*="/jobs/"],a[href*="/positions/"],a[href*="/vacancies/"]'))
          })
          if(!listingControl){await action('non_listing_control_ignored',page.url());break}
          const before = await page.locator('body').innerText(), step:ControlStep={operation:'click',role:'button',name:(await more.innerText()).trim()}
          try { await more.click({timeout:3000}) }
          catch {
            incompleteControls=true
            await request.onAction?.({operation:'pagination_control_unavailable',url:page.url(),at:new Date().toISOString(),outcome:'failed',detail:'Could not activate listing control within 3 seconds; retain visible evidence as partial'})
            break
          }
          controls.push(step); await action('click',page.url(),step); await page.waitForTimeout(700)
          if (await page.locator('body').innerText() === before) break
        }
        if (forbiddenNavigation || excluded(page.url())) throw Error('source_redirect_forbidden')
        const snapshot = await page.evaluate((extraction) => {
          const text = document.body.innerText
          const httpUrl=(value:string)=>{try{const u=new URL(value);if(!/^https?:$/.test(u.protocol))return;u.hash='';return u.href}catch{return}}
          const links: {text:string;url:string;kind?:'posting';languageAlternative?:boolean}[] = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap(a => {
            const url=httpUrl(a.href)
            const languageAlternative=a.hasAttribute('hreflang')||!!a.closest('[class*="language" i],[class*="lang-" i],[id*="language" i],[id*="lang-" i],[aria-label*="language" i]')
            return url?[{text:a.rel==='next'||/next/i.test(a.getAttribute('aria-label')??'')?'Next page':a.innerText.trim(),url,...(languageAlternative?{languageAlternative:true}:{})}]:[]
          })
          for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[src]')) {
            if (/greenhouse|ashbyhq|lever\.co|recruitee|workable|smartrecruiters|teamtailor|bamboohr/i.test(frame.src)) links.push({ text: 'Job openings', url: frame.src })
          }
          const linkedRoleTitles=new Set<string>()
          // Structural card evidence, independent of employer URL conventions. These
          // are listing links, not descriptions; the configured title policy decides relevance.
          for(const heading of document.querySelectorAll('main h1,main h2,main h3,main h4,article h2,article h3,[class*="cards-item"] h2,[class*="cards-item"] h3,[class*="cards-item"] h4')) {
            const title=heading.textContent?.replace(/\s+/g,' ').trim()??''
            const anchor=heading.closest<HTMLAnchorElement>('a[href]')??heading.querySelector<HTMLAnchorElement>('a[href]')
            if(!anchor||!title||title.length>180||!/\b(?:engineer|developer|manager|designer|analyst|tester|specialist|representative|recruiter|officer|consultant|architect|administrator|artist|owner|QA|SDET)\b|разработчик|аналитик/i.test(title))continue
            const target=httpUrl(anchor.href)
            if(!target||target===location.href)continue
            const link=links.find(link=>link.url===target)
            if(link){link.text=title;link.kind='posting';linkedRoleTitles.add(title)}
          }
          const jobs: any[] = []
          const applicationLinks = [...document.querySelectorAll<HTMLAnchorElement>('main a[href], article a[href], p a[href], li a[href]')]
            .filter(a => !a.closest('footer,nav') && /^(https?:\/\/(t\.me|telegram\.me)\/|tg:)/i.test(a.href))
            .map(a => ({ url: a.href, text: a.closest('p,li')?.textContent?.trim() ?? a.textContent?.trim() ?? '' }))
          const readable = (element: Element) => {
            const copy = element.cloneNode(true) as Element
            // Some public ATS pages wrap the whole job description in the same
            // form as the application controls. Preserve its prose and remove
            // only interactive fields; collection never interacts with it.
            copy.querySelectorAll('script,style,noscript,template,img,video,audio,iframe,svg,canvas,object,embed,nav,footer,input,textarea,select,button,[hidden],[aria-hidden="true"]').forEach(node => node.remove())
            copy.querySelectorAll('[id*="cookie" i],[class*="cookie-banner" i],[id*="onetrust" i],[id*="consent-banner" i]').forEach(node=>node.remove())
            copy.querySelectorAll('a[href]').forEach(node => {
              const href = node.getAttribute('href') ?? ''
              if (/^https?:\/\/(?:t\.me|telegram\.me)\//i.test(href)) node.append(document.createTextNode(' (' + href + ')'))
            })
            copy.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,section').forEach(node => node.prepend(document.createTextNode('\n')))
            return (copy.textContent ?? '').replace(/[\t \r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
          }
          const readableJobDetail = () => {
            const heading = document.querySelector('[class*="job-title" i], [class*="jobTitle"], [class*="banner__title"], main h1, article h1, h1')
            const semantic = heading?.closest('[class*="job-detail" i], [class*="vacancy-detail" i], [class*="position-detail" i]')
            const root = document.querySelector('main,[role="main"]') ?? semantic ?? document.body
            const copy = root.cloneNode(true) as Element
            copy.querySelectorAll('[class*="other-jobs" i],[id*="other-jobs" i],[class*="related-jobs" i],[id*="related-jobs" i],[class*="similar-jobs" i],[id*="similar-jobs" i],aside').forEach(node => node.remove())
            const roleSections = /responsibilit|qualifications?|requirements?|you will|your role|what you.ll do|tech stack|обязанност|требован|вам предстоит/i
            copy.querySelectorAll('form').forEach(form => {
              if (!roleSections.test(form.textContent ?? '')) form.remove()
              else form.querySelectorAll('label,input,textarea,select,button,fieldset,[class*="upload" i],[class*="consent" i],[class*="privacy" i]').forEach(node => node.remove())
            })
            return readable(copy)
          }
          const actionLabel = /^(?:apply(?: now| for (?:this|the) (?:job|role))?|view (?:job|role|details)|read more|learn more|details)$/i
          const visibleJobHeading = () => {
            const slug = decodeURIComponent(location.pathname).split('/').filter(Boolean).pop()?.replace(/[-_]+/g, ' ').toLowerCase() ?? ''
            const candidates = [...document.querySelectorAll('[class*="job-title" i], [class*="jobTitle"], [class*="vacancy-title" i], [class*="position-title" i], [class*="banner__title"], main h1, article h1, h1, main h2, article h2')]
              .filter(element => !!element.getClientRects().length)
              .map((element, index) => ({ element, index, title: (element.textContent ?? '').replace(/\s+/g, ' ').trim() }))
              .filter(candidate => candidate.title.length >= 3 && candidate.title.length <= 180 && !actionLabel.test(candidate.title) && !/^(?:cookie preferences?|thank you!?|oops[.!]?|careers?|current job openings|job listings?)$/i.test(candidate.title))
            const score = (candidate: typeof candidates[number]) => {
              const normalized = candidate.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
              const slugMatch = slug && (normalized === slug || slug.includes(normalized) || normalized.includes(slug)) ? 100 : 0
              const semanticClass = /job-title|jobTitle|vacancy-title|position-title|banner__title/i.test(candidate.element.className?.toString() ?? '') ? 40 : 0
              const heading = candidate.element.tagName === 'H1' ? 20 : 0
              return slugMatch + semanticClass + heading - candidate.index / 1000
            }
            const best = candidates.sort((left, right) => score(right) - score(left))[0]
            return best && score(best) >= 20 ? best.title : undefined
          }
          function collect(value: any) {
            if (Array.isArray(value)) return value.forEach(collect)
            if (!value || typeof value !== 'object') return
            if (value['@graph']) collect(value['@graph'])
            if (value['@type'] !== 'JobPosting') return
            const description = document.createElement('div'); description.innerHTML = value.description ?? ''
            // Placeholder listing JSON-LD must not collapse distinct jobs into the careers-page identity.
            if (!value.url && readable(description).length < 80) return
            const locations = Array.isArray(value.jobLocation) ? value.jobLocation : [value.jobLocation]
            const postingUrl = new URL(typeof value.url === 'string' ? value.url : location.href, location.href).href
            jobs.push({ title: value.title, company: value.hiringOrganization?.name ?? document.title.split('|').pop()?.trim() ?? '', description: readable(description), publishedAt: typeof value.datePosted === 'string' ? value.datePosted : undefined, location: locations.map((l: any) => l?.address ? [l.address.addressLocality, l.address.addressCountry].filter(Boolean).join(', ') : '').filter(Boolean).join(' | ') + (value.jobLocationType === 'TELECOMMUTE' ? ' Remote' : ''), url: postingUrl, applyUrl: postingUrl === location.href ? links.find(l => /^apply( now| for this job)?$/i.test(l.text))?.url ?? postingUrl : postingUrl })
          }
          // Public accordion panels already contain readable job text; no application controls are clicked.
          const panels=new Set<string>()
          for(const control of document.querySelectorAll('button[data-bs-target],button[aria-controls]')){
            const target=control.getAttribute('data-bs-target')??'#'+control.getAttribute('aria-controls')
            if(!/^#(?:vacancy[-_]description|job|vacancy|position)[-_]\d+$/i.test(target)||panels.has(target))continue
            const panel=document.getElementById(target.slice(1)),title=control.textContent?.trim()
            if(!panel||!title)continue
            const url=new URL(location.href);url.hash=panel.id;panels.add(target)
            if(!jobs.some(j=>j.url===url.href))jobs.push({title,company:'',description:readable(panel.querySelector('.accordion-body')??panel),location:'',url:url.href,applyUrl:url.href})
          }
          let extractionEmpty=false
          if(extraction) {
            const rows=extraction.listingSelector?[...document.querySelectorAll(extraction.listingSelector)]:[document.body]
            for(const row of rows) {
              const anchor=extraction.detailLinkSelector?row.querySelector<HTMLAnchorElement>(extraction.detailLinkSelector):null
              if(anchor?.href)links.push({text:anchor.innerText.trim(),url:anchor.href})
              const title=extraction.titleSelector?row.querySelector(extraction.titleSelector)?.textContent?.trim():undefined
              const body=extraction.descriptionSelector?row.querySelector(extraction.descriptionSelector):undefined
              if(title&&body)jobs.push({title,company:'',description:readable(body),location:extraction.locationSelector?row.querySelector(extraction.locationSelector)?.textContent?.trim()??'':'',url:anchor?.href??location.href,applyUrl:anchor?.href??location.href})
            }
            if(extraction.paginationSelector)for(const next of document.querySelectorAll<HTMLAnchorElement>(extraction.paginationSelector))if(next.href)links.push({text:'Next page',url:next.href})
            if(extraction.emptyStateSelector) {
              const empty=[...document.querySelectorAll(extraction.emptyStateSelector)].find(node=>node.getClientRects().length)
              const emptyText=empty?.textContent?.replace(/\s+/g,' ').trim()??''
              extractionEmpty=/\b(?:no (?:current |open |available )?(?:positions|vacancies|roles|jobs|postings)(?: found)?|not (?:currently )?hiring|0 (?:positions|vacancies|roles|jobs|postings) found)\b/i.test(emptyText)
            }
          }
          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) { try { collect(JSON.parse(script.textContent ?? '')) } catch {} }
          const roleHeading = [...document.querySelectorAll('h1,.t-title')].some(e=>/engineer|developer|разработчик|QA[- ]|аналитик/i.test(e.textContent??''))
          const roleSections = /responsibilities|requirements|чем ты будешь заниматься|наши ожидания/i.test(text)
          const detailUrl = /\/(?:jobs?|positions?|vacanc(?:y|ies)|j|o)\/[^/?]+|\/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(location.pathname) || location.hostname.endsWith('.applytojob.com')&&/^\/apply\/[^/]+\/[^/]+\/?$/.test(location.pathname)
            || location.hostname.endsWith('.notion.site') && /(?:engineer|developer|разработчик).*-[0-9a-f]{32}$/i.test(decodeURIComponent(location.pathname))
            || roleHeading && roleSections
          const visibleTitle = detailUrl ? visibleJobHeading() : undefined
          if (visibleTitle) for (const job of jobs) if (job.url === location.href && actionLabel.test(job.title?.trim() ?? '')) job.title = visibleTitle
          if (detailUrl) for (const job of jobs) if (job.url === location.href) {
            const visibleDetail=readableJobDetail()
            const roleSections=/responsibilit|qualifications?|requirements?|you will|your role|what you.ll do|tech stack|обязанност|требован|вам предстоит/i
            if (visibleDetail.length>=80 && roleSections.test(visibleDetail) && (job.description.length<80 || !roleSections.test(job.description) || visibleDetail.length>job.description.length*1.5)) job.description=visibleDetail
          }
          // Related vacancy cards do not turn a clearly headed detail page into a listing.
          if (!jobs.length && (!linkedRoleTitles.size || visibleTitle && roleHeading && roleSections) && detailUrl && /\bapply\b|submit application|send.{0,60}(?:cv|resume)|отклик|присыла.{0,30}резюме|отправ.{0,30}резюме/i.test(text)) {
            const title = visibleTitle || [...document.querySelectorAll('.t-title')].find(e=>/engineer|developer|разработчик|QA[- ]|аналитик/i.test(e.textContent??''))?.textContent?.trim() || document.title
            if (title) jobs.push({ title, company: '', description: readableJobDetail(), location: '', url: location.href, applyUrl: links.find(l => /^apply( now| for this job)?$/i.test(l.text))?.url ?? location.href })
          }
          if (!jobs.length && !linkedRoleTitles.size && /career/i.test(location.pathname) && /required qualifications|requirements|responsibilities/i.test(text)) {
            const titles = [...document.querySelectorAll('h1,h2,h3,h4')].map(node => node.textContent?.trim() ?? '').filter(title => /engineer|developer|разработчик/i.test(title))
            const linkedRole=titles.length===1&&links.some(link=>link.url!==location.href&&link.text.includes(titles[0])&&/\/(?:careers?|jobs?|positions?|vacancies)\/[^/?]+/i.test(new URL(link.url).pathname))
            if (titles.length === 1 && !linkedRole && /apply|cv|resume|résumé|резюме/i.test(text)) jobs.push({ title: titles[0], company: document.title.split('|').pop()?.trim() ?? location.hostname, description: readable(document.querySelector('main,article') ?? document.body), location: '', url: location.href, applyUrl: links.find(l => /^apply( now| for this job)?$/i.test(l.text))?.url ?? location.href })
          }
          const listingLinks = links.some(l => /career|vacanc|\/(?:jobs?|positions?|roles?)(?:\/|\?|$)|open.roles|open.positions|view.jobs|all.jobs|job.openings/i.test(l.text + ' ' + l.url) && l.url !== location.href)
          const explicitlyEmpty = extractionEmpty || /\b(?:no (?:current |open |available )?(?:positions|vacancies|roles|jobs|postings)(?: found)?|not (?:currently )?hiring|0 (?:positions|vacancies|roles|jobs|postings) found)\b/i.test(text)
          const paginationPending = [...document.querySelectorAll('button')].some(b => {
            if(!b.getClientRects().length||b.disabled||b.closest('form'))return false
            if(/^load more$/i.test(b.innerText.trim())) {
              const section=b.closest('section,article')??b.parentElement
              if(!section||!(/(?:jobs?|positions?|vacancies|engineer|developer)/i.test([...section.querySelectorAll('h1,h2,h3')].map(h=>h.textContent).join(' '))||section.querySelector('a[href*="/jobs/"],a[href*="/positions/"],a[href*="/vacancies/"]')))return false
            }
            return [b.innerText,b.getAttribute('aria-label')??''].some(label=>/^(?:load more(?: jobs)?|show more jobs|view more jobs|next(?: page)?|\d+)$/i.test(label.trim()))
          })
          // Closed accessible job panels can be title-filtered without expanding
          // irrelevant roles. They are audit observations, never invented postings.
          const unlinkedListings=/\/(?:jobs|careers|vacancies)(?:\/|$)/i.test(location.pathname)
            ? [...document.querySelectorAll('button[id][aria-expanded][aria-controls]')]
              .filter(button=>!button.closest('form')&&button.getClientRects().length&&button.querySelector('h2,h3,h4'))
              .map(button=>({title:button.querySelector('h2,h3,h4')!.textContent!.trim(),selector:'#'+CSS.escape(button.id)})) : []
          const partial = paginationPending || (!jobs.length && !listingLinks && !explicitlyEmpty && !unlinkedListings.length)
          for (const job of jobs) if (job.url === location.href) job.applicationLinks = applicationLinks
          const headline = [...document.querySelectorAll('h1,h2,[role="heading"]')].map(e => e.textContent ?? '').join(' ')
          const authRequired = /(?:sign in|log in|register|create an account).{0,80}(?:view|access|see).{0,50}(?:jobs|vacanc|positions)|(?:войдите|зарегистрируйтесь).{0,80}(?:ваканс|просмотр)/i
          const password = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].some(e => !!e.getClientRects().length)
          const accessGate = !jobs.length && !listingLinks && (authRequired.test(text) || password && /sign in|log in|register|create an account|вход|регистрац/i.test(headline))
            ? { kind: /register|create an account|зарегистр|регистрац/i.test(headline + ' ' + text) ? 'registration_required' : 'login_required', url: location.href, evidence: (headline || text).slice(0, 500) }
            : undefined
          const data=(element:Element)=>Object.fromEntries([...element.attributes].filter(attribute=>attribute.name.startsWith('data-')||['aria-controls','aria-expanded','onclick','target'].includes(attribute.name)).slice(0,8).map(attribute=>[attribute.name,attribute.value.slice(0,160)]))
          const controls=[...document.querySelectorAll('button,[role="tab"],input')].filter(element=>{
            if(!element.getClientRects().length)return false
            const value=[element.id,element.className,element.getAttribute('aria-label'),element.textContent,element.getAttribute('name')].join(' ')
            return /job|role|vacan|position|career|department|studio|team|location|search|filter|next|previous|forward|back|load|show|engineer|developer|разработчик|^\s*\d+\s*$/i.test(value)
          }).slice(0,40).map(element=>({tag:element.tagName,id:element.id,className:typeof element.className==='string'?element.className.slice(0,240):'',role:element.getAttribute('role'),name:(element.getAttribute('aria-label')??element.textContent??element.getAttribute('name')??'').trim().slice(0,160),type:element.getAttribute('type'),data:data(element)}))
          const dynamicCards=[...document.querySelectorAll('a:not([href]),[role="button"],h2,h3,h4,[class*="card" i],[class*="title" i]')]
            .filter(element=>/engineer|developer|разработчик|view details/i.test(element.textContent??''))
            .flatMap(element=>[element,element.parentElement,element.parentElement?.parentElement].filter((node):node is Element=>!!node&&node.tagName!=='BODY'&&node.tagName!=='HTML'))
          const cards=[...new Set([...document.querySelectorAll('a[href],article,li,[class*="job" i],[class*="vacan" i],[class*="position" i],[data-job-id],[data-testid*="job" i]'),...dynamicCards])].filter(element=>{
            if(!element.getClientRects().length)return false
            const value=[element.id,element.className,element.getAttribute('href'),element.textContent].join(' ')
            return /engineer|developer|разработчик|QA[- ]|аналитик|\/(?:jobs?|positions?|vacancies)\//i.test(value)
          }).slice(0,40).map(element=>({tag:element.tagName,id:element.id,className:typeof element.className==='string'?element.className.slice(0,240):'',role:element.getAttribute('role'),text:(element.textContent??'').replace(/\s+/g,' ').trim().slice(0,200),...(element instanceof HTMLAnchorElement&&element.href?{href:element.href}:{}),data:data(element)}))
          const diagnostics={controls,headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.textContent?.trim()??'').filter(Boolean).slice(0,30),cards}
          return { url: location.href, text: text.slice(0, 40000), links, jobs, unlinkedListings, partial, paginationPending, explicitlyEmpty, diagnostics, ...(accessGate ? { accessGate } : {}) }
        },request.extraction)
        // Captured popup destinations have not been opened; all subsequent reads use normal policy.
        let blockedPopup=false
        for(const link of await popupLinks.links()){
          if(excluded(link.url)){blockedPopup=true;await action('popup_link_forbidden',link.url);continue}
          const existing=snapshot.links.find(existing=>existing.url===link.url)
          if(existing){existing.text=link.text;existing.kind='posting'}else snapshot.links.push({...link,kind:'posting'})
        }
        // Public embedded configuration often contains the board URL before a lazy widget renders.
        const html = (await page.content()).replace(/\\u002f/gi, '/').replace(/\\\//g, '/')
        const embedded = html.match(/https?:\/\/(?:(?:jobs\.ashbyhq\.com|job-boards(?:\.eu)?\.greenhouse\.io|jobs\.(?:eu\.)?lever\.co|(?:jobs|careers)\.smartrecruiters\.com)\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_.-]+\.teamtailor\.com\/?)/g) ?? []
        const normalizedEmbedded=embedded.map(board=>board.replace('://careers.smartrecruiters.com/', '://jobs.smartrecruiters.com/'))
        for (const board of [...boardUrls, ...normalizedEmbedded]) if (!snapshot.links.some(l => l.url === board)) snapshot.links.push({ text: 'ATS job openings', url: board })
        if ((boardUrls.size || embedded.length || vacancyLinks(snapshot.links,snapshot.url).some(link=>link.url!==snapshot.url)) && !snapshot.paginationPending && !snapshot.accessGate) snapshot.partial=false
        if(incompleteControls)snapshot.partial=true
        if(blockedPopup)snapshot.partial=true
        await action('extract',snapshot.url)
        if(snapshot.accessGate)await captureFailure()
        return { ...snapshot, diagnostics:{...snapshot.diagnostics,listingRequests:[...listingRequests.values()]}, controls, method:'browser', accessGate: snapshot.accessGate as SourceAccessGate | undefined, ...(/(?:this (?:job|position)|vacancy).{0,50}(?:closed|no longer available|no longer accepting)/i.test(snapshot.text) && !snapshot.jobs.length ? {closedEvidence:'Official page explicitly states the posting is closed'} : {}) }
      } catch(error) {if(forbiddenNavigation)throw Error('source_redirect_forbidden');await captureFailure();throw error} finally { await page.close() }
    })
    hosts.set(host, task)
    const result = await task
    await options.onPage?.(result).catch(() => {})
    return result
  }
  return { read }
}

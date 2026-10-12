import { positionId } from '../infrastructure/identity.ts'
import { resolvePostingLink } from './posting-link.ts'
import type { Position, SourceAudit, PageReader, DiscoveryStrategy } from '../types.ts'
import { CollectionPersistenceError } from './persistence-error.ts'
import { applicationDestinations } from './application-destinations.ts'
import type { SourceReviews } from './source-reviews.ts'
import { vacancyLinks, isFullFeedBoard } from './navigation.ts'
import { descriptionIssue } from './description-quality.ts'
import { mergePublicationDateOutcomes, titlePrecheckMetadata, recordTitleRouting } from './title-precheck.ts'
import type { TitlePrecheck, TitlePrecheckSkip } from './title-precheck.ts'
import { publicationDateAudit } from './publication-date-precheck.ts'
export { basicFit } from '../candidate_matching/basic-fit.ts'

export function createWebsiteStrategy(options: { reader: PageReader; maxPages?: number; concurrency?: number; name?: string; entryUrls?: (source: import('../types.ts').Source) => string[]; reviews?: SourceReviews; titlePrecheck?:TitlePrecheck; onSource?: (audit: SourceAudit, positions: Position[]) => void | Promise<void> }): DiscoveryStrategy {
  return { name: options.name ?? 'websites', discover: async (sources, _candidate, progress) => {
    const positions: Position[] = [], audit: SourceAudit[] = []
    let next = 0, stopped = false
    async function worker() {
      while (!stopped && next < sources.length) {
        const source = sources[next++]; const queue = [...new Set(options.entryUrls?.(source) ?? [source.url, ...(source.listingUrls ?? [])])]; const visited = new Set<string>()
        const sourceJobs = new Set<string>(), completeDetails = new Set<string>(), sourcePositions = new Map<string,Position>(), titleRejectedIds=new Set<string>(),publicationRejectedIds=new Set<string>(), skipped=new Map<string,TitlePrecheckSkip>(),publicationOutcomes:import('./publication-date-precheck.ts').PublicationDateAudit[]=[]; let explicitlyEmpty = false, listingEvidence=false
        const report: SourceAudit = { source, status: 'complete', pages: [], found: 0, issues: [] }
        const rejectTitle=(title:string,url:string,context:'posting'|'navigation'='posting')=>{if(!options.titlePrecheck)return false;const decision=options.titlePrecheck.evaluate(title,context);if(decision.decision==='continue')return false;let id:string;try{id=positionId(url)}catch{return false} titleRejectedIds.add(id);skipped.set(id,{title,url,ruleId:decision.ruleId,reason:decision.reason,policyHash:options.titlePrecheck.policyHash});return true}
        const rejectDetailLinkTitle=(title:string,url:string)=>{let path='',jazz=false;try{const u=new URL(url);path=u.pathname;jazz=u.hostname.endsWith('.applytojob.com')&&/^\/apply\/[^/]+\/[^/]+\/?$/.test(path)}catch{return false}const roleCareer=/\/careers?\/[^/]+\/?$/i.test(path)&&/engineer|developer|head|lead|designer|analyst|manager|consultant|architect|administrator|artist|owner/i.test(title);const rejected=(/\/(?:jobs?|positions?|vacancies|careers\/v)\/[^/]+\/?$/i.test(path)||jazz||roleCareer)&&!!title.trim()&&rejectTitle(title,url,'navigation');if(rejected)listingEvidence=true;return rejected}
        const pending = await options.reviews?.pending(source)
        if (pending) {
          report.status = 'unavailable'; report.accessGate = pending; report.issues.push('Source access awaits human review; not retried.')
          audit.push(report); await options.onSource?.(report, []); continue
        }
        let pageReads=0
        while (!stopped && queue.length && pageReads < (options.maxPages ?? 16)) {
          const url = queue.shift()!; if (visited.has(url) || completeDetails.has(positionId(url)) || titleRejectedIds.has(positionId(url)) || publicationRejectedIds.has(positionId(url))) continue; visited.add(url)
          const pagePositions: Position[] = []
          pageReads++
          try {
            const page = await options.reader.read(url); report.pages.push(page.url)
            if (page.accessGate) {
              report.status = 'partial'
              const listingGate = report.pages.length === 1 && !sourceJobs.size
              report.issues.push(`${listingGate ? 'Source' : 'Individual page'} access requires human review: ${page.accessGate.kind}: ${page.url}`)
              if (listingGate) {
                report.accessGate = page.accessGate
                try { await options.reviews?.queue(source, page.accessGate) }
                catch (cause) { throw new CollectionPersistenceError('source_review_save_failed', { cause }) }
                queue.length = 0; break
              }
              continue
            }
            visited.add(page.url)
            if (/no (?:current |open |available )?(?:positions|vacancies|roles|jobs|postings)|not (?:currently )?hiring/i.test(page.text)) explicitlyEmpty = true
            // A validated full ATS inventory may contain empty descriptions for
            // title/date-excluded roles. Retained descriptions are checked below.
            if (page.partial && !page.listingInventoryComplete) { report.status = 'partial'; report.issues.push(`Additional dynamic results or controls remain: ${page.url}`) }
            for(const card of page.unlinkedListings??[]){
              listingEvidence=true
              const decision=options.titlePrecheck?.evaluate(card.title)
              if(decision?.decision==='excluded')skipped.set(JSON.stringify([page.url,card.title]),{title:card.title,url:page.url,ruleId:decision.ruleId,reason:decision.reason,policyHash:options.titlePrecheck!.policyHash})
              else {report.status='partial';report.issues.push(`Job panel requires detail extraction: ${card.title} (${card.selector})`)}
            }
            for (const rawJob of page.jobs) {
              let job = rawJob
              try { job = resolvePostingLink(rawJob, page) } catch { /* Existing malformed-record validation follows. */ }
              let id: string
              try {
                if (typeof job.title !== 'string' || !job.title.trim() || typeof job.url !== 'string') throw Error('Missing title or URL')
                id = positionId(job.url)
              } catch { report.status = 'partial'; report.issues.push(`Malformed vacancy record omitted from ${page.url}: missing title or valid HTTP(S) URL`); continue }
              listingEvidence=true
              if(rejectTitle(job.title,job.url))continue
              const position = recordTitleRouting({ ...job, company: typeof job.company === 'string' && job.company.trim() ? job.company : source.name, description: typeof job.description === 'string' ? job.description : '', location: typeof job.location === 'string' ? job.location : '', applyUrl: typeof job.applyUrl === 'string' && /^https?:\/\//.test(job.applyUrl) ? job.applyUrl : job.url, id, retrievedAt: page.fetchedAt ?? new Date().toISOString(), source },options.titlePrecheck)
              const publication=options.titlePrecheck?.publication?.evaluate(position)
              if(publication&&publication.decision!=='continue')publicationOutcomes.push(publicationDateAudit(position,publication,options.titlePrecheck!.publication!.policyHash))
              if(publication?.decision==='excluded'){publicationRejectedIds.add(id);continue}
              const quality = descriptionIssue(position.description)
              if ((page.completeListing || page.listingInventoryComplete) && !quality) completeDetails.add(id)
              const destinations = applicationDestinations(job)
              if (destinations.length) position.applicationDestinations = destinations
              const previous=sourcePositions.get(id)
              if (!previous || position.description.length>previous.description.length) {
                if (!position.publishedAt && previous?.publishedAt) position.publishedAt=previous.publishedAt
                position.publicationDates=[...new Set([...(previous?.publicationDates??[]),...(previous?.publishedAt?[previous.publishedAt]:[]),...(position.publicationDates??[]),...(position.publishedAt?[position.publishedAt]:[])])]
                sourcePositions.set(id,position)
              } else {
                if (!previous.publishedAt && position.publishedAt) previous.publishedAt=position.publishedAt
                previous.publicationDates=[...new Set([...(previous.publicationDates??[]),...(previous.publishedAt?[previous.publishedAt]:[]),...(position.publicationDates??[]),...(position.publishedAt?[position.publishedAt]:[])])]
              }
              sourceJobs.add(position.id); report.found = sourceJobs.size
              pagePositions.push(position)
            }
            {
              const ownDetail=page.jobs.some(j => { try { return positionId(j.url) === positionId(page.url) && j.description.trim().length >= 80 } catch { return false } })
              const links = vacancyLinks(page.links,page.url,source.name).filter(link=>!ownDetail||isFullFeedBoard(link.url))
              const priority:string[]=[]
              for (const link of links) {
                if(link.kind==='posting'&&rejectTitle(link.text,link.url)){listingEvidence=true;continue}
                if (positionId(link.url)!==positionId(page.url) && !titleRejectedIds.has(positionId(link.url)) && !publicationRejectedIds.has(positionId(link.url)) && !rejectDetailLinkTitle(link.text,link.url) && !visited.has(link.url) && !queue.includes(link.url)) {
                  const urgent=link.kind==='posting'||/\b(?:engineer|developer)\b|разработчик/i.test(link.text)||/(?:greenhouse\.io|ashbyhq\.com|lever\.co|recruitee\.com)$/.test(new URL(link.url).hostname)
                  ;(urgent?priority:queue).push(link.url)
                }
              }
              queue.unshift(...priority)
            }
            if (page.completeListing || page.listingInventoryComplete) {
              const explicit = new Set(source.listingUrls ?? [])
              for (let i=queue.length-1;i>=0;i--) if (completeDetails.has(positionId(queue[i])) || (!explicit.has(queue[i]) && new URL(queue[i]).hostname.replace(/^www\./,'')===new URL(source.url).hostname.replace(/^www\./,''))) queue.splice(i,1)
            }
          } catch (error: any) {
            if (error instanceof CollectionPersistenceError) throw error
            report.issues.push(`${url}: ${String(error.message ?? error).slice(0, 200)}`); report.status = 'partial'
          }
          // Outside the website-error handler: failed durable storage is fatal.
          if (pagePositions.length) await progress?.positions(pagePositions)
        }
        if (stopped) return
        positions.push(...sourcePositions.values())
        for (const position of sourcePositions.values()) {
          const quality=descriptionIssue(position.description)
          if (quality) { report.status='partial'; report.issues.push(`${quality}: ${position.url}`) }
        }
        if (queue.length) { report.status = 'partial'; report.issues.push(`Page budget reached; ${queue.length} links not inspected`) }
        if (!report.found && !explicitlyEmpty && !listingEvidence) { report.status = 'partial'; report.issues.push('No vacancy details confirmed; this is incomplete coverage, not evidence of no suitable roles.') }
        if (!report.pages.length) report.status = 'unavailable'
        if(options.titlePrecheck)report.titlePrecheck=titlePrecheckMetadata(options.titlePrecheck,[...skipped.values()])
        if(options.titlePrecheck?.publication)report.publicationDatePrecheck=mergePublicationDateOutcomes(undefined,publicationOutcomes,options.titlePrecheck.publication.policyHash)
        audit.push(report)
        await options.onSource?.(report, positions.filter(position => position.source === source))
      }
    }
    const workers = await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(3, Math.floor(Number(options.concurrency) || 3), sources.length)) }, () => worker().catch(error => { stopped = true; throw error })))
    const failed = workers.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    audit.sort((a, b) => sources.indexOf(a.source) - sources.indexOf(b.source))
    return { positions, audit }
  } }
}
export function createDialogStrategy(reader: PageReader, pasted: Position[] = [], titlePrecheck?:TitlePrecheck): DiscoveryStrategy {
  const web = createWebsiteStrategy({ reader, maxPages: 1, name: 'dialog', titlePrecheck })
  return { name: 'dialog', discover: async (sources, candidate, progress) => {
    const result = await web.discover(sources, candidate, progress)
    for (const p of pasted) if (titlePrecheck?.evaluate(p.title).decision!=='excluded'&&!result.positions.some(x => positionId(x.url) === positionId(p.url))) {
      const position = recordTitleRouting({ ...p, id: positionId(p.url), fit: { decision: 'review' as const, reasons: ['Pasted posting not independently verified'], evidence: [] } },titlePrecheck)
      result.positions.push(position); await progress?.positions([position])
    }
    return result
  } }
}
export { discoverPositions } from '../candidate_matching/discover.ts'

import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { DiscoveryStrategy, PageDocument, PageReader, Position, Source, SourceAudit } from '../../types.ts'
import { positionId } from '../../infrastructure/identity.ts'
import { basicFit } from '../../candidate_matching/basic-fit.ts'
import { CollectionPersistenceError } from '../persistence-error.ts'
import { titlePrecheckMetadata, recordTitleRouting } from '../title-precheck.ts'
import type { TitlePrecheck, TitlePrecheckSkip } from '../title-precheck.ts'

// Import the installed skill's public fetch routine, without modifying its token lists.
const PYTHON = `import sys,json,importlib.util,concurrent.futures
spec=importlib.util.spec_from_file_location("job_sweep",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
tasks=json.loads(sys.stdin.read())
def run(t):
 rows,error=m.fetch(t)
 return {"ats":t[0],"org":t[1],"rows":rows,"error":error}
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
 print(json.dumps(list(ex.map(run,tasks))))
`
export function createSkillStrategy(options: { skillPath: string; python?: string; boards: { ats: 'ashby' | 'greenhouse' | 'lever'; org: string }[]; reader: PageReader; titlePrecheck?:TitlePrecheck }): DiscoveryStrategy {
  return { name: 'job-hunting', discover: async (sources, candidate, progress) => {
    const script = resolve(options.skillPath, 'scripts', 'sweep_boards.py')
    await access(script); await access(resolve(options.skillPath, 'SKILL.md'))
    if (!options.boards.length) throw Error('Provide an explicit, bounded skill board list')
    const output = await new Promise<string>((accept, reject) => {
      const child = spawn(options.python ?? 'python', ['-B', '-c', PYTHON, script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 40_000_000) child.kill() })
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000) })
      child.on('error', () => reject(Error('Job-hunting preflight failed: Python 3 is unavailable')))
      child.on('close', code => code === 0 ? accept(stdout) : reject(Error(`Job-hunting sweep failed (${code}): ${stderr}`)))
      child.stdin.end(JSON.stringify(options.boards.map(b => [b.ats, b.org])))
    })
    const results = JSON.parse(output); const positions: Position[] = [], audit: SourceAudit[] = []
    for (const result of results) {
      const boardUrl=result.ats === 'ashby' ? `https://jobs.ashbyhq.com/${result.org}` : result.ats === 'lever' ? `https://jobs.lever.co/${result.org}` : `https://job-boards.greenhouse.io/${result.org}`
      const source:Source=sources.find(source=>source.url===boardUrl||source.listingUrls?.includes(boardUrl))??{name:result.org,url:boardUrl,provenance:`job-hunting/scripts/sweep_boards.py:${result.ats}`}
      const report: SourceAudit = { source, status: result.error ? 'unavailable' : 'complete', pages: result.error ? [] : [source.url], found: result.rows.length, issues: result.error ? [result.error] : [] }
      const skipped:TitlePrecheckSkip[]=[]
      const relevant = result.rows.filter((r:string[])=>{
        const decision=options.titlePrecheck?.evaluate(r[2])
        if(decision?.decision==='excluded'){skipped.push({title:r[2],url:r[4],ruleId:decision.ruleId,reason:decision.reason,policyHash:options.titlePrecheck!.policyHash});return false}
        return !candidate||basicFit({title:r[2],description:''} as Position,candidate)?.decision!=='excluded'
      })
      if(options.titlePrecheck)report.titlePrecheck=titlePrecheckMetadata(options.titlePrecheck,skipped)
      report.found=relevant.length
      const start = positions.length
      // One public board read supplies all descriptions; don't refetch it per vacancy.
      if (relevant.length) {
        let page: PageDocument | undefined
        try {
          page = await options.reader.read(boardUrl)
          if (page.partial) report.status = 'partial'
        } catch (error) { if (error instanceof CollectionPersistenceError) throw error; report.status = 'partial'; report.issues.push('Could not retrieve posting descriptions') }
        // A failed detail read must not erase the valid posting identities found by the sweep.
        for (const row of relevant) {
          const body = page?.jobs.find(j => positionId(j.url) === positionId(row[4]))
          positions.push(recordTitleRouting({ company: result.org, title: row[2], location: row[3], description: '', url: row[4], applyUrl: row[4], ...body, id: positionId(row[4]), source, retrievedAt: page?.fetchedAt ?? new Date().toISOString() },options.titlePrecheck))
        }
      }
      if (positions.length > start) await progress?.positions(positions.slice(start))
      audit.push(report)
    }
    return { positions, audit }
  } }
}

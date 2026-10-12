import type { Position, Source, SourceAudit } from '../types.ts'
import { descriptionIssue } from './description-quality.ts'

/** Revalidate extraction evidence without changing an immutable historical collection. */
export function validateSourceDescriptions(audits: SourceAudit[], positions: Position[]): SourceAudit[] {
  const key=(source:Source)=>source.database?.sourceId??JSON.stringify([source.name,source.url,source.provenance??'',source.workbook??null])
  const issues=new Map<string,Set<string>>()
  for(const position of positions) {
    const issue=descriptionIssue(position.description)
    if(!issue)continue
    for(const source of position.sources??[position.source]) {
      const id=key(source),values=issues.get(id)??new Set<string>()
      values.add(`${issue}: ${position.url}`);issues.set(id,values)
    }
  }
  return audits.map(audit=>{
    const found=new Set(issues.get(key(audit.source))??[])
    if(audit.titlePrecheck?.skipped.some(row=>/^(?:apply(?: now| for this job)?|view (?:job|role|details)|learn more|read more)$/i.test(row.title.trim())))found.add('Job title extraction returned an action label; title exclusions cannot establish complete coverage')
    if(!found.size)return audit
    const trace=audit.trace?{...audit.trace,recipe:undefined}:undefined
    return {...audit,status:'partial',issues:[...new Set([...audit.issues,...found])],...(trace?{trace}:{})}
  })
}

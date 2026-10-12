import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { safeId, diagnostic } from '../infrastructure/store.ts'
import type { Candidate, CvSource, CvExtractor, Criteria, HistoryEntry, Store } from '../types.ts'

export function fileCvSource(path: string): CvSource {
  return { read: async () => ({ bytes: await readFile(path), fileName: basename(path) }) }
}
export async function intakeCandidate(input: {
  id: string; source: CvSource; confirmed?: Record<string, string>; criteria: Criteria; history?: HistoryEntry[]; stackIds?:string[]; databaseClientId?:string
}, deps: { store: Store; storageRoot: string; extractor: CvExtractor }): Promise<Candidate> {
  safeId(input.id)
  if (input.databaseClientId !== undefined && !/^[1-9][0-9]*$/.test(input.databaseClientId)) throw Error('Invalid database student ID')
  if (!input.criteria.titles?.length) throw Error('At least one target role is required')
  const { bytes, fileName } = await input.source.read()
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('CV must be a PDF')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const facts = await deps.extractor.extract(bytes, fileName)
  if(input.stackIds?.some(id=>!id.trim()))throw Error('Invalid candidate stack identifier')
  for (const [key, value] of Object.entries(input.confirmed ?? {})) facts[key] = { value, source: 'confirmed', evidence: 'Explicit candidate answer' }
  const directory = resolve(deps.storageRoot, 'candidates', input.id, 'cv'); await mkdir(directory, { recursive: true })
  const cvPath = join(directory, `${sha256}.pdf`)
  await writeFile(cvPath, bytes, { flag: 'wx', mode: 0o600 }).catch((e: any) => { if (e.code !== 'EEXIST') throw e })
  if (createHash('sha256').update(await readFile(cvPath)).digest('hex') !== sha256) throw Error('Stored CV hash mismatch')
  const candidate: Candidate = { id: input.id, cv: { path: cvPath, sha256, fileName: basename(fileName) }, facts, criteria: input.criteria, history: input.history ?? [], createdAt: new Date().toISOString() }
  const release = await deps.store.lock(input.id)
  try {
    let previous: Candidate | undefined
    try { previous = await deps.store.candidate(input.id) } catch (e: any) { if (!String(e.message).startsWith('Candidate not found')) throw e }
    if (previous) {
      candidate.history = [...previous.history, ...candidate.history].filter((h, i, all) => all.findIndex(x => x.url === h.url && x.status === h.status) === i)
      for (const [key, fact] of Object.entries(previous.facts)) if (fact.source === 'confirmed' && !Object.hasOwn(input.confirmed ?? {}, key)) candidate.facts[key] = fact
    }
    candidate.stackIds=input.stackIds===undefined?previous?.stackIds:[...new Set(input.stackIds)]
    candidate.databaseClientId = input.databaseClientId ?? previous?.databaseClientId
    await deps.store.saveCandidate(candidate)
  } finally { await release() }
  await diagnostic(deps.store, { at: candidate.createdAt, runId: `intake-${sha256.slice(0, 12)}`, candidateId: input.id, action: 'intake_completed', data: { cvHash: sha256, factKeys: Object.keys(facts) } })
  return candidate
}

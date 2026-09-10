import type { Context } from './writer-types.ts'

export type SourceAccount = {
  platformAccountId: number; clientId: number; clientName: string; linkedinUrl?: string
  unipileAccountId?: string; verifiedProviderId?: string; unipileAccountStatus?: string
  readinessErrorCode?: string; authErrorCode?: string
}
export type CvDocument = { bytes: Buffer; revision: string; mimeType?: string; fileName?: string }
export type ExtractedFacts = Omit<Context, 'revision'>
export type FactsExtractor = (document: CvDocument) => Promise<ExtractedFacts>
export type ModelResponder = (input: unknown, schema: unknown, instructions: string) => Promise<unknown>
export type SourceDependencies = {
  accounts(): Promise<SourceAccount[]>
  cvRows(): Promise<Record<string, unknown>[]>
  selectCv(rows: Record<string, unknown>[], clientId: number): { url: string; revision: string }
  loadCv(url: string, maxBytes: number): Promise<CvDocument>
  extractFacts: FactsExtractor
}

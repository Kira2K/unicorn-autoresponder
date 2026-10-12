export type Fact = { value: string; source: 'cv' | 'confirmed'; evidence: string }
export type Candidate = {
  id: string; cv: { path: string; sha256: string; fileName: string }
  facts: Record<string, Fact>; criteria: Criteria; history: HistoryEntry[]; createdAt: string; stackIds?: string[]; databaseClientId?: string
  seniorityExceptions?: import('./candidate_matching/seniority.ts').SeniorityException[]
}
export type Criteria = {
  titles: string[]; excludedTitles?: string[]; seniorOnly?: boolean
  skills?: string[]; authorizedCountries?: string[]; languages?: string[]
  maxBackendPercent?: number; notes?: string
}
export type HistoryEntry = {
  url: string; company: string; title: string
  status: 'succeeded' | 'unknown' | 'skipped' | 'rejected' | 'blocked'
  evidence?: string; confirmation?: 'captured' | 'operator_reported'; date?: string
}
export type WorkbookReference = { fileId: string; fileName: string; sheet: string; row: number; companyCell: string; careerCell: string }
export type CompanyMarket = { value: 'global' | 'ru'; basis: 'default' | 'jurisdiction_evidence'; evidence: string[] }
export type VacancyMarket = { value: 'global' | 'ru' | 'unknown'; language: 'en' | 'ru' | 'unknown'; evidence: string[] }
export type ApplicationDestination = { channel: 'telegram' | 'web'; address: string; evidence: string }
export type SourceAccessGate = { kind: 'login_required' | 'registration_required' | 'robot_rejected' | 'captcha_required'; url: string; evidence: string }
export type Source = { name: string; url: string; provenance?: string; workbook?: WorkbookReference; listingUrls?: string[]; market?: CompanyMarket; database?: { companyId: string; sourceId: string; applicationRoute: 'standard_workflow' | 'notify_only' } }
export type Position = {
  id: string; company: string; title: string; location: string; description: string
  url: string; applyUrl: string; retrievedAt: string; source: Source
  sources?: Source[]
  /** Provisional title routing in collection audit; canonical membership requires full assessment. */
  titleRouting?: {candidateStackIds:string[];policyHash:string;scopeHash:string}
  publicationLabels?: string[]
  publicationDates?: string[]
  publicationEvidence?: { sourceId: string; runId: string; url: string; observedAt: string }[]
  publishedAt?: string
  applicationDestinations?: ApplicationDestination[]
  market?: VacancyMarket
  compensation?: import('./stack_classification/salary.ts').Compensation
  extraction?: {runId?:string;sourceId:string;recipeRevision?:string;engine?:import('./vacancy_collection/source-memory.ts').EngineReference}
  fit?: { decision: 'eligible' | 'review' | 'excluded'; reasons: string[]; evidence: string[] }
  restrictionChecks?: import('./candidate_matching/restrictions.ts').RestrictionCheck[]
}
export type SourceAudit = {
  source: Source; status: 'complete' | 'partial' | 'unavailable'
  pages: string[]; found: number; issues: string[]
  terminal?: boolean; accessGate?: SourceAccessGate
  titlePrecheck?: import('./vacancy_collection/title-precheck.ts').TitlePrecheckMetadata
  publicationDatePrecheck?: { policyHash: string; checkedAt: string; outcomes: import('./vacancy_collection/publication-date-precheck.ts').PublicationDateAudit[] }
  trace?: import('./vacancy_collection/source-memory.ts').SourceTrace
}
export type DiscoveryResult = {
  runId: string; candidateId: string; strategy: string; positions: Position[]
  audit: SourceAudit[]; createdAt: string
}
export type Reason = 'captcha_required' | 'robot_rejected' | 'email_verification_required' |
  'input_required' | 'validation_error' | 'unsupported_form' | 'network_error' |
  'unknown_outcome' | 'posting_closed' | 'already_applied' | 'employer_ai_ban' | 'employer_cooldown' | 'restriction_applies' | 'restriction_review'
export type Evidence = {
  url: string; observedAt: string; screenshot?: string; message: string
  confirmation?: 'captured' | 'operator_reported'; responses?: string[]
}
export type Outcome = {
  status: 'succeeded' | 'failed' | 'blocked' | 'unknown'; reason?: Reason
  detail: string; evidence?: Evidence; manualAssistance?: boolean
}
export type Field = {
  key: string; label: string; type: string; required: boolean; options: string[]
}
export type FormInspection = {
  fields: Field[]; text: string; url: string; closed: boolean; aiBan: boolean
  minimumDaysBetweenApplications?: number
  gate?: Reason
}
export type Answer = { value: string; evidence: string[] }
export type Answers = { values: Record<string, Answer>; missing: Field[] }
export type EmployerAiException = { reason: string; ownWordsFieldKey: string }
export type ApplicationRecord = {
  preparation?: import('./application_preparation/checkpoint.ts').PreparationCheckpoint
  cvRevisions?: { parent: import('./application_preparation/tailoring.ts').PreparedCv; resultHash: string; reason: string; evidence: string; at: string }[]
  retryAuthorizations?: RetryAuthorization[]
  preparedCv?: import('./application_preparation/tailoring.ts').PreparedCv
  position: Position; status: 'prepared' | 'submitting' | 'skipped' | Outcome['status']
  reason?: Reason; detail: string; attempt: number; updatedAt: string; reviewOverride?: string
  answers?: Answers; fields?: Field[]; evidence?: Evidence; manualAssistance?: boolean
  humanAssistance?: { observedAt: string; reference: string }
  employerAiException?: EmployerAiException
  outcomes?: (Outcome & { attempt: number })[]
}
export type RetryAuthorization = { candidateId: string; batchId: string; positionId: string; afterAttempt: number; approvedAt: string; approvalReference: string }
export type BatchState = {
  cvSelection?: { mode: 'original'; path: string; sha256: string; approval: import('./application_preparation/original-cv.ts').OriginalCvApproval }
  campaignProgress?: import('./application_workflow/campaign.ts').CampaignState
  testCampaign?: { id: string; answerOverride: boolean }
  id: string; candidateId: string; targetIds: string[]; limit: number
  records: ApplicationRecord[]; createdAt: string; updatedAt: string
  collection?: {runId:string;digest:string;stackId:string;studentId?:string}
}
export type Event = {
  at: string; action: string; runId: string; candidateId: string
  positionId?: string; attempt?: number; data?: Record<string, unknown>
}
export type Store = {
  candidate(id: string): Promise<Candidate>
  saveCandidate(candidate: Candidate): Promise<void>
  batch(candidateId: string, batchId: string): Promise<BatchState | undefined>
  saveBatch(batch: BatchState): Promise<void>
  batches(candidateId: string): Promise<BatchState[]>
  lock(candidateId: string): Promise<() => Promise<void>>
  event(event: Event): Promise<void>
}
export type CvSource = { read(): Promise<{ bytes: Buffer; fileName: string }> }
export type CvExtractor = { extract(bytes: Buffer, fileName: string): Promise<Record<string, Fact>> }
export type AnswerGenerator = {
  /** Opt in only for field-local answers with a stable, versioned policy/configuration key. */
  cacheKey?(candidate: Candidate, position: Position, field: Field): string
  generate(candidate: Candidate, position: Position, form: FormInspection): Promise<Answers>
}
export type VerificationHandler = { queue(record: ApplicationRecord, batch: BatchState): Promise<void> }
export type ApplicationFormMemory = {
  inspect(position: Position, engine: string, fields: Field[]): Promise<'known' | 'changed' | 'new'>
  verified(position: Position, engine: string, fields: Field[], at: string): Promise<void>
}
export type ApplicationSession = {
  inspect(): Promise<FormInspection>
  fill(candidate: Candidate, answers: Answers): Promise<void>
  verify(candidate: Candidate, answers: Answers): Promise<string[]>
  /** Keys whose uploaded CV bytes and current attachment display were verified in this session. */
  verifiedUploadKeys?(): string[]
  submit(): Promise<Outcome>
  reconcile(): Promise<Outcome>
  /** Continue the same intent only with proven verification completion and no application request sent. */
  continueAfterCaptcha?(beforeSubmit: () => Promise<boolean>): Promise<Outcome>
  close(): Promise<void>
}
export type ApplicationAdapter = { name: string; version?: string; supports(position: Position): boolean; open(position: Position): Promise<ApplicationSession> }
export type DiscoveryProgress = { positions(positions: Position[]): Promise<void> }
export type DiscoveryStrategy = { name: string; discover(sources: Source[], candidate?: Candidate, progress?: DiscoveryProgress): Promise<{ positions: Position[]; audit: SourceAudit[] }> }
export type PageDiagnostics = {
  controls: { tag:string; id:string; className:string; role:string|null; name:string; type:string|null; data:Record<string,string> }[]
  headings: string[]
  cards: { tag:string; id:string; className:string; role:string|null; text:string; href?:string; data:Record<string,string> }[]
  listingRequests: { url:string; method:string; resourceType:string }[]
}
export type PageDocument = { url: string; text: string; links: { text: string; url: string; kind?: 'posting'; languageAlternative?: boolean }[]; jobs: (Omit<Position, 'id' | 'retrievedAt' | 'source'> & { applicationLinks?: { text: string; url: string }[] })[]; unlinkedListings?: {title:string;selector:string}[]; completeListing?: boolean; /** ATS inventory is exhaustive; retained description completeness is validated after title/date filtering. */ listingInventoryComplete?: boolean; partial?: boolean; fetchedAt?: string; accessGate?: SourceAccessGate; method?: string; controls?: import('./vacancy_collection/source-memory.ts').ControlStep[]; explicitlyEmpty?: boolean; closedEvidence?: string; httpValidator?: {endpoint:string;etag?:string;lastModified?:string}; diagnostics?:PageDiagnostics; evidenceRef?:string; evidenceHash?:string }
export type PageReadOptions = { steps?: import('./vacancy_collection/source-memory.ts').ControlStep[]; extraction?:import('./vacancy_collection/source-memory.ts').ExtractionSelectors; previous?:PageDocument; onAction?: (action: import('./vacancy_collection/source-memory.ts').SourceAction) => Promise<void> }
export type PageReader = { read(url: string, options?: PageReadOptions): Promise<PageDocument> }

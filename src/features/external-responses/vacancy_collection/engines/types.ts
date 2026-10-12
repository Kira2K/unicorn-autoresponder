import type { ControlStep } from '../source-memory.ts'

export type EngineInput = {
  sourceId: string
  url: string
  text: string
  links: { text: string; url: string }[]
  jobs: EngineJob[]
  meta?: Record<string, string | number | boolean | null>
}

export type EngineJob = {
  title: string
  location: string
  description: string
  url: string
  applyUrl: string
  publicationLabels?: string[]
  publishedAt?: string
}

export type EngineExtraction = {
  listingSelector?: string
  detailLinkSelector?: string
  titleSelector?: string
  locationSelector?: string
  descriptionSelector?: string
  paginationSelector?: string
  emptyStateSelector?: string
}

export type EnginePlan = {
  entryUrls: string[]
  reads?: { url: string; steps?: ControlStep[] }[]
  extraction?: EngineExtraction
}

export type EngineParseResult = {
  url: string
  text: string
  links: { text: string; url: string }[]
  jobs: EngineJob[]
}

export type EngineResult =
  | { kind: 'plan'; value: EnginePlan }
  | { kind: 'parse'; value: EngineParseResult }

export type EngineFixtureExpectation = {
  kind: EngineResult['kind']
  minimumJobs?: number
  jobUrls?: string[]
  excludedJobUrls?: string[]
  entryUrls?: string[]
  substantiveText?: string[]
}

export type EngineFixture = {
  name: string
  input: EngineInput
  expected: EngineFixtureExpectation
}

export type EngineFixtureEvidence = {
  name: string
  inputSha256: string
  outputSha256: string
}

export type EngineArtifact = {
  id: string
  version: number
  code: string
  sha256: string
  sourceIds: string[]
  createdAt: string
  fixtures: EngineFixtureEvidence[]
}

export type EngineReference = Pick<EngineArtifact, 'id' | 'version' | 'sha256'>

export type EngineBinding = EngineReference & {
  sourceId: string
  activatedAt: string
  previous?: EngineReference
}

export type EngineValidation = {
  artifact: EngineReference
  sourceId: string
  fixtures: EngineFixtureEvidence[]
  liveOutputSha256: string
  validatedAt: string
}

export type EngineLiveEvidence = {
  coverage: 'complete' | 'partial' | 'unavailable'
  paginationComplete: boolean
  explicitlyEmpty: boolean
}

export type EngineRuntimeOptions = { timeoutMs: number; memoryLimitBytes: number }

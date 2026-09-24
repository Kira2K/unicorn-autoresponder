export type MemeConcept = { postAnchor: string; scene: string; style: string
  captionLines: string[]; prompt: string; altText: string }
export type MemeHistory = Pick<MemeConcept, 'scene' | 'style' | 'captionLines'>
export type MemeInput = { post: string; audience: string; forbiddenTopics: string[]; history: MemeHistory[]; feedback?: string }
export type MemePlan = { status: 'ready'; reason: ''; concept: MemeConcept; warnings?: string[] } |
  { status: 'blocked'; reason: string; concept: null }
export type MemeAsset = { id: string; sourceHash: string; sha256: string; width: number; height: number
  byteLength: number; mimeType: 'image/png'; altText: string }
export type MemeFile = { asset: MemeAsset; content: string }
export interface MemeAssets {
  get(id: string): Promise<MemeFile | undefined>
  put(id: string, sourceHash: string, bytes: Uint8Array, altText: string): Promise<MemeAsset>
}
export type MemeReview = { issues: string[]; repair: string }
export type MemeState = { sourceHash: string; assetId: string; policyHash: string
  status: 'pending' | 'planning' | 'repair_pending' | 'planned' | 'rendering' | 'reviewing' | 'ready' | 'blocked' | 'uncertain' | 'cancelled'
  concept?: MemeConcept; asset?: MemeAsset; errorCode?: string; blockingReason?: string
  plannerCalls: number; imageCalls: number; warnings?: string[]; qa?: MemeReview; qaCalls?: number
  qaStage?: 'reviewing' | 'repairing' | 'reviewing_repair' | 'done'; repairAsset?: MemeAsset; repairQa?: MemeReview }
export type MemeServices = { enabled: boolean; policy: string; assets: MemeAssets
  plan(input: MemeInput): Promise<unknown>
  review?(input: MemeInput, image: MemeFile, concept: MemeConcept): Promise<MemeReview>
  render(prompt: string, signal?: AbortSignal): Promise<Uint8Array> }
export type MemeOptions = { id: string; signal?: AbortSignal; checkpoint?: MemeState
  onCheckpoint(state: MemeState): Promise<void> }

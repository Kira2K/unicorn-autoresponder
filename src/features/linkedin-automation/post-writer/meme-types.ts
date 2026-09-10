export type MemeConcept = { postAnchor: string; scene: string; style: string
  captionLines: string[]; prompt: string; altText: string }
export type MemeHistory = Pick<MemeConcept, 'scene' | 'style' | 'captionLines'>
export type MemeInput = { post: string; audience: string; forbiddenTopics: string[]; history: MemeHistory[] }
export type MemePlan = { status: 'ready'; reason: ''; concept: MemeConcept } |
  { status: 'blocked'; reason: string; concept: null }
export type MemeAsset = { id: string; sourceHash: string; sha256: string; width: number; height: number
  byteLength: number; mimeType: 'image/png'; altText: string }
export type MemeFile = { asset: MemeAsset; content: string }
export interface MemeAssets {
  get(id: string): Promise<MemeFile | undefined>
  put(id: string, sourceHash: string, bytes: Uint8Array, altText: string): Promise<MemeAsset>
}
export type MemeState = { sourceHash: string; assetId: string; policyHash: string
  status: 'pending' | 'planning' | 'planned' | 'rendering' | 'ready' | 'blocked' | 'uncertain' | 'cancelled'
  concept?: MemeConcept; asset?: MemeAsset; errorCode?: string; blockingReason?: string
  plannerCalls: number; imageCalls: number }
export type MemeServices = { enabled: boolean; policy: string; assets: MemeAssets
  plan(input: MemeInput): Promise<unknown>
  render(prompt: string, signal?: AbortSignal): Promise<Uint8Array> }
export type MemeOptions = { id: string; signal?: AbortSignal; checkpoint?: MemeState
  onCheckpoint(state: MemeState): Promise<void> }

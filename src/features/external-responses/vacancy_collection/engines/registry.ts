import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertCompleteLiveResult, validateEngineParseResult } from './schema.ts'
import { runEngineFixtures, sha256, stableJson } from './artifact.ts'
import type { EngineArtifact, EngineBinding, EngineFixture, EngineLiveEvidence, EngineParseResult, EngineRuntimeOptions, EngineValidation } from './types.ts'

const ID = /^[a-z][a-z0-9-]{1,63}$/
const SHA = /^[a-f0-9]{64}$/
const SOURCE = /^[A-Za-z0-9_.:-]{1,128}$/
const validatedCandidates = new WeakSet<EngineValidation>()

function validateReference(value: unknown, name: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`engine_${name}_invalid_reference`)
  const reference = value as { id?: unknown; version?: unknown; sha256?: unknown }
  if (Object.keys(reference).some(key => !['id', 'version', 'sha256'].includes(key)) || typeof reference.id !== 'string' || !ID.test(reference.id) || !Number.isInteger(reference.version) || (reference.version as number) < 1 || typeof reference.sha256 !== 'string' || !SHA.test(reference.sha256)) throw Error(`engine_${name}_invalid_reference`)
}

export function validateArtifact(value: unknown): EngineArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('engine_artifact_must_be_object')
  const artifact = value as EngineArtifact
  const allowed = ['id', 'version', 'code', 'sha256', 'sourceIds', 'createdAt', 'fixtures']
  const unexpected = Object.keys(artifact).find(key => !allowed.includes(key))
  if (unexpected) throw Error(`engine_artifact_unexpected_field:${unexpected}`)
  if (!ID.test(artifact.id)) throw Error('engine_artifact_invalid_id')
  if (!Number.isInteger(artifact.version) || artifact.version < 1) throw Error('engine_artifact_invalid_version')
  if (typeof artifact.code !== 'string' || sha256(artifact.code) !== artifact.sha256 || !SHA.test(artifact.sha256)) throw Error('engine_artifact_hash_mismatch')
  if (!Array.isArray(artifact.sourceIds) || !artifact.sourceIds.length || new Set(artifact.sourceIds).size !== artifact.sourceIds.length || artifact.sourceIds.some(id => !SOURCE.test(id))) throw Error('engine_artifact_invalid_source_ids')
  if (!Number.isFinite(Date.parse(artifact.createdAt))) throw Error('engine_artifact_invalid_created_at')
  if (!Array.isArray(artifact.fixtures) || !artifact.fixtures.length) throw Error('engine_artifact_fixture_evidence_required')
  const names = new Set<string>()
  for (const evidence of artifact.fixtures) {
    if (!evidence || typeof evidence !== 'object' || !evidence.name?.trim() || names.has(evidence.name) || !SHA.test(evidence.inputSha256) || !SHA.test(evidence.outputSha256)) throw Error('engine_artifact_invalid_fixture_evidence')
    if (Object.keys(evidence).some(key => !['name', 'inputSha256', 'outputSha256'].includes(key))) throw Error('engine_artifact_invalid_fixture_evidence')
    names.add(evidence.name)
  }
  return artifact
}

export function validateForSource(artifact: EngineArtifact, sourceId: string) {
  validateArtifact(artifact)
  if (!SOURCE.test(sourceId) || !artifact.sourceIds.includes(sourceId)) throw Error('engine_artifact_source_not_bound')
}

export const artifactPath = (root: string, artifact: Pick<EngineArtifact, 'id' | 'version' | 'sha256'>) => {
  if (!ID.test(artifact.id) || !Number.isInteger(artifact.version) || artifact.version < 1 || !SHA.test(artifact.sha256)) throw Error('engine_artifact_invalid_reference')
  return join(root, 'generated', artifact.id, `${artifact.version}-${artifact.sha256}.json`)
}

export async function writeArtifact(root: string, artifact: EngineArtifact): Promise<string> {
  validateArtifact(artifact)
  const target = artifactPath(root, artifact), body = `${JSON.stringify(artifact, null, 2)}\n`
  await mkdir(dirname(target), { recursive: true })
  try {
    const file = await open(target, 'wx')
    try { await file.writeFile(body, 'utf8') } finally { await file.close() }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    if (await readFile(target, 'utf8') !== body) throw Error('engine_artifact_immutable_conflict')
  }
  return target
}

export async function loadArtifact(root: string, reference: Pick<EngineArtifact, 'id' | 'version' | 'sha256'>): Promise<EngineArtifact> {
  const artifact = validateArtifact(JSON.parse(await readFile(artifactPath(root, reference), 'utf8')))
  if (artifact.id !== reference.id || artifact.version !== reference.version || artifact.sha256 !== reference.sha256) throw Error('engine_artifact_reference_mismatch')
  return artifact
}

export async function validateEngineCandidate(input: { artifact: EngineArtifact; sourceId: string; fixtures: EngineFixture[]; liveResult: EngineParseResult; liveEvidence: EngineLiveEvidence }, limits: EngineRuntimeOptions): Promise<EngineValidation> {
  validateForSource(input.artifact, input.sourceId)
  const evidence = await runEngineFixtures(input.artifact.code, input.fixtures, limits)
  if (stableJson(evidence) !== stableJson(input.artifact.fixtures)) throw Error('engine_artifact_fixture_evidence_mismatch')
  const live = validateEngineParseResult(input.liveResult)
  assertCompleteLiveResult(live, input.liveEvidence)
  const validation: EngineValidation = {
    artifact: { id: input.artifact.id, version: input.artifact.version, sha256: input.artifact.sha256 },
    sourceId: input.sourceId,
    fixtures: evidence,
    liveOutputSha256: sha256(stableJson({ document: live, evidence: input.liveEvidence })),
    validatedAt: new Date().toISOString()
  }
  validatedCandidates.add(validation)
  return validation
}

const bindingPath = (root: string, sourceId: string) => {
  if (!SOURCE.test(sourceId)) throw Error('engine_binding_invalid_source_id')
  return join(root, 'bindings', `${sourceId}.json`)
}

export async function loadBinding(root: string, sourceId: string): Promise<EngineBinding | undefined> {
  try { return validateBinding(JSON.parse(await readFile(bindingPath(root, sourceId), 'utf8')), sourceId) }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw cause }
}

export function validateBinding(value: unknown, expectedSourceId?: string): EngineBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('engine_binding_must_be_object')
  const binding = value as EngineBinding
  if (Object.keys(binding).some(key => !['sourceId', 'id', 'version', 'sha256', 'activatedAt', 'previous'].includes(key))) throw Error('engine_binding_unexpected_field')
  validateReference({ id: binding.id, version: binding.version, sha256: binding.sha256 }, 'binding')
  if (!SOURCE.test(binding.sourceId) || expectedSourceId !== undefined && binding.sourceId !== expectedSourceId || !Number.isFinite(Date.parse(binding.activatedAt))) throw Error('engine_binding_invalid')
  if (binding.previous !== undefined) validateReference(binding.previous, 'binding_previous')
  return binding
}

async function atomicWrite(target: string, value: unknown) {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  await open(temporary, 'wx').then(async file => { try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8') } finally { await file.close() } })
  try { await rename(temporary, target) } catch (cause) { await rm(temporary, { force: true }); throw cause }
}

export async function activateBinding(root: string, artifact: EngineArtifact, validation: EngineValidation): Promise<EngineBinding> {
  validateForSource(artifact, validation.sourceId)
  if (!validatedCandidates.has(validation)) throw Error('engine_activation_requires_current_process_validation')
  if (validation.artifact.id !== artifact.id || validation.artifact.version !== artifact.version || validation.artifact.sha256 !== artifact.sha256) throw Error('engine_activation_validation_mismatch')
  const current = await loadBinding(root, validation.sourceId)
  const binding: EngineBinding = {
    sourceId: validation.sourceId,
    id: artifact.id,
    version: artifact.version,
    sha256: artifact.sha256,
    activatedAt: new Date().toISOString(),
    ...(current ? { previous: { id: current.id, version: current.version, sha256: current.sha256 } } : {})
  }
  await atomicWrite(bindingPath(root, binding.sourceId), binding)
  return validateBinding(binding, validation.sourceId)
}

export async function rollbackBinding(root: string, sourceId: string): Promise<EngineBinding> {
  const current = await loadBinding(root, sourceId)
  if (!current?.previous) throw Error('engine_binding_has_no_previous')
  const restored: EngineBinding = { sourceId, ...current.previous, activatedAt: new Date().toISOString(), previous: { id: current.id, version: current.version, sha256: current.sha256 } }
  await loadArtifact(root, restored)
  await atomicWrite(bindingPath(root, sourceId), restored)
  return restored
}

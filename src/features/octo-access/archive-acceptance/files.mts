// Diagnostic handoff only: no network listener, production worker or credentials.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acceptOwnerProof, accountDigest, assertNewFixture, digest, parsePreflight, parseProof, parseRequest, requireCheck } from './contract.mts';
import type { OwnerPreflight, OwnerRequest, OwnerProof, FixtureIdentity, Marker } from './contract.mts';
export function machineIdentity() {
  requireCheck(process.platform === 'win32', 'archive_windows_owner_required');
  // Stable across account switches, VPNs and network adapters. Only the hash is exported.
  const value = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
    { encoding: 'utf8', windowsHide: true });
  const guid = value.match(/REG_SZ\s+([a-f0-9-]{36})/i)?.[1];
  requireCheck(guid, 'archive_machine_identity_unavailable'); return digest(guid.toLowerCase());
}
export async function readJson(path: string) {
  const bytes = await readFile(path); requireCheck(bytes.length <= 2_000_000, 'archive_artifact_too_large');
  return JSON.parse(bytes.toString('utf8'));
}
export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temporary, path);
}
export interface OwnerVerifier {
  verify(profile: FixtureIdentity, marker: Marker, cycle: number): Promise<OwnerProof>;
}
export async function ownerVerifierFromEnv(env: NodeJS.ProcessEnv = process.env) {
  requireCheck(env.OCTO_ARCHIVE_OWNER_PREFLIGHT && env.OCTO_ARCHIVE_HANDOFF_DIR && env.OCTO_E2E_OWNER_EMAIL,
    'archive_owner_handoff_required');
  const preflight = parsePreflight(await readJson(env.OCTO_ARCHIVE_OWNER_PREFLIGHT));
  requireCheck(preflight.account === accountDigest(env.OCTO_E2E_OWNER_EMAIL) &&
    preflight.account !== accountDigest(env.OCTO_GUEST_EMAIL ?? 'kind.cute.unicorn@gmail.com'), 'archive_owner_account_mismatch');
  return createFileOwnerVerifier({ preflightPath: env.OCTO_ARCHIVE_OWNER_PREFLIGHT,
    directory: env.OCTO_ARCHIVE_HANDOFF_DIR, runId: randomUUID(),
    onRequest: path => console.log(JSON.stringify({ stage: 'owner_reopen_required', request: path })) });
}
export async function createFileOwnerVerifier(options: { preflightPath: string; directory: string; runId: string;
  timeoutMs?: number; now?: () => number; sourceMachine?: string;
  onRequest?: (path: string) => void; onProof?: (proof: OwnerProof) => void }): Promise<OwnerVerifier> {
  const preflight = parsePreflight(await readJson(options.preflightPath));
  const sourceMachine = options.sourceMachine ?? machineIdentity(), now = options.now ?? Date.now;
  requireCheck(sourceMachine !== preflight.machine, 'archive_independent_owner_required');
  return {
    async verify(profile, marker, cycle) {
      const request: OwnerRequest = { schema: 1, id: randomUUID(), runId: options.runId, sourceMachine,
        preflightId: preflight.id, issuedAt: now(), cycle, operation: 'reopen', profile, marker };
      assertNewFixture(request, preflight);
      parseRequest(request);
      const base = resolve(options.directory, request.id), requestPath = `${base}.request.json`;
      await writeJson(requestPath, request); options.onRequest?.(requestPath);
      const deadline = now() + (options.timeoutMs ?? 900_000);
      do {
        let proof: OwnerProof | undefined;
        try { proof = parseProof(await readJson(`${base}.proof.json`)); }
        catch (error) { if ((error as any)?.code !== 'ENOENT') throw error; }
        if (proof) { options.onProof?.(proof); acceptOwnerProof(request, proof, preflight); return proof; }
        await new Promise(done => setTimeout(done, 1000));
      } while (now() < deadline);
      throw Object.assign(new Error('archive_owner_proof_timeout'), { code: 'archive_owner_proof_timeout' });
    }
  };
}

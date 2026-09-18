import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import { createSqlFeatureServices } from './feature-services.mts';
import { featureTestProviders } from './feature-test-providers.mts';
import { createSqlTestConsole } from './test-app.mts';
import { serveTestApp } from './workflow-http.mts';
import { defaults } from '../../../linkedin-automation/post-writer/types.ts';
export async function featureAcceptance(db: ConsoleSql, grant: ConsoleWrites, account: number) {
  const p = featureTestProviders(), checks: string[] = [];
  let services = await createSqlFeatureServices(db, grant, p.providers);
  let server = await serveTestApp(createSqlTestConsole(db, grant, undefined, undefined, services));
  const login = async () => {
    const response = await fetch(server.base + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unicornveryevil@gmail.com', password: '101010' }) });
    assert.equal(response.status, 200); return { Cookie: String(response.headers.get('set-cookie')).split(';')[0], 'Content-Type': 'application/json' };
  };
  const until = async (read: () => Promise<Record<string, unknown> | undefined>, status: string) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) { const job = await read(); if (job?.status === status) return job;
      if (['failed','error','needs_expert_review','blocked'].includes(String(job?.status))) throw Error('unexpected_status:' + job?.status);
      await setTimeout(50); }
    throw Error('acceptance_status_timeout:' + status);
  };
  try {
    assert.equal((await fetch(server.base + '/api/admin/linkedin/profile-jobs')).status, 401);
    let headers = await login();
    for (const path of ['profile-jobs', 'connection-runs', 'comment-monitors', `accounts/${account}/post-writer`])
      assert.equal((await fetch(server.base + '/api/admin/linkedin/' + path, { headers })).status, 200);
    checks.push('protected API reads use actual services');
    const started = await services.profileFiller.startGeneration(account);
    await until(() => services.profileFiller.get(String(started.jobId)), 'preview_ready');
    assert.equal(p.metrics.patches, 0); checks.push('CV generation saves Preview without external PATCH');
    const plain = await services.profileFiller.startPreview(account, { schema_version: 1, profile: { headline: 'SQL fixture updated' } });
    const preview = await until(() => services.profileFiller.get(String(plain.jobId)), 'preview_ready');
    await assert.rejects(services.profileFiller.apply(String(plain.jobId), 'wrong'));
    await services.profileFiller.apply(String(plain.jobId), String(preview.planHash));
    await until(() => services.profileFiller.get(String(plain.jobId)), 'succeeded');
    assert.equal(p.metrics.patches, 1); checks.push('Profile Apply intent, fake PATCH, fresh read-back and final result');
    const monitor = await services.commentMonitor.enable(account); await services.commentMonitor.disable(account);
    assert.equal((await services.commentMonitor.get(String(monitor.jobId)))?.status, 'disabled');
    assert.equal((await services.connectionInviter.readiness(account)).ready, true);
    checks.push('Comment Monitor save/Stop and Inviter readiness');
    await services.postWriter.update(account, { ...defaults(account), memes: true });
    const post = await services.postWriter.start(account, 'approval_required', 'sql-acceptance-one');
    assert.equal((await services.postWriter.start(account, 'automatic', 'sql-acceptance-two')).id, post.id);
    const generationDeadline = Date.now() + 30000;
    while (Date.now() < generationDeadline) { await services.postWriter.tick();
      if ((await services.postWriter.get(account)).runs[0]?.status === 'awaiting_approval') break; await setTimeout(50); }
    const waiting = (await services.postWriter.get(account)).runs[0]; assert.equal(waiting.status, 'awaiting_approval');
    assert(waiting.meme); assert.equal(p.metrics.publishes, 0);
    await server.close(); await services.close();
    services = await createSqlFeatureServices(db, grant, p.providers);
    server = await serveTestApp(createSqlTestConsole(db, grant, undefined, undefined, services)); headers = await login();
    assert.equal((await services.postWriter.get(account)).runs[0].hash, waiting.hash);
    await assert.rejects(services.postWriter.action(post.id, 'approve', waiting.hash), /meme_review_required/);
    await services.postWriter.action(post.id, 'approve', waiting.hash, waiting.hash);
    for (let i=0; i<60; i++) { p.advance(6000); await services.postWriter.tick();
      if ((await services.postWriter.get(account)).runs[0].status === 'published') break; await setTimeout(100); }
    assert.equal((await services.postWriter.get(account)).runs[0].status, 'published');
    assert.equal(p.metrics.publishes, 1); assert.equal(p.metrics.likes, 0);
    checks.push('Writer: meme approval, double click, restart and one fake publication');
    assert.equal((await fetch(server.base + '/api/admin/linkedin/profile-jobs', { headers })).status, 200);
    assert.equal(p.metrics.patches, 1); checks.push('reload preserves Profile result without another PATCH');
    return checks;
  } finally { await server.close(); await services.close(); }
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { registerConnectionInviterRoutes } from '../connection-inviter-routes.ts';
import type { ConnectionInviterService } from '../connection-inviter-types.ts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';

test('Inviter returns safe 503 for a temporary SQL read failure without relaxing mutation errors', async () => {
  let error: Error = new PostgresReadError('postgres_read_unavailable'), calls = 0;
  const service = { async readiness() { calls++; throw error; } } as unknown as ConnectionInviterService;
  const app = express();
  registerConnectionInviterRoutes({ app, requireAdmin: (_req, _res, next) => next(), service });
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const [code, status] of [['postgres_read_unavailable', 503], ['postgres_write_failed', 500],
      ['commit_uncertain', 500], ['postgres_read_failed', 500], ['noco_unreachable', 503]] as const) {
      error = Object.assign(Error('SECRET provider payload'), { code });
      const response = await fetch(base + '/api/admin/linkedin/accounts/7/connection-readiness');
      assert.equal(response.status, status, code);
      const body = await response.json(); assert(!JSON.stringify(body).includes('SECRET'));
      if (code === 'postgres_read_unavailable') assert.equal(body.error, 'connection_storage_read_unavailable');
    }
    assert.equal(calls, 5);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

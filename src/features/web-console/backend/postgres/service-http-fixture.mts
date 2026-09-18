import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Express } from 'express';
import type { WebConsoleRepository } from '../types.ts';
import { serveTestApp } from './workflow-http.mts';
import { workflowTestServices } from './workflow-test-services.mts';
const { createWebConsoleApp } = createRequire(import.meta.url)('../app.ts') as {
  createWebConsoleApp(options: Record<string, unknown>): Express;
};
// Real routes and services; only their external adapters are replaced by the caller.
export async function serviceHttpFixture(repository: WebConsoleRepository, services: Record<string, unknown>) {
  const server = await serveTestApp(createWebConsoleApp({ repository, useMockData: true,
    ...workflowTestServices([]), ...services }));
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown) => fetch(server.base + path, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { ...server, request, async login() {
    const response = await request('/api/auth/login', 'POST', { email: 'unicornveryevil@gmail.com', password: '101010' });
    assert.equal(response.status, 200);
    cookie = String(response.headers.get('set-cookie')).split(';')[0];
  } };
}

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { profileName, TestError } from './contract.mts';
import type { ProfileName } from './contract.mts';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new TestError('json_body_required', 415);
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString('utf8');
    if (Buffer.byteLength(text) > 1024) throw new TestError('body_too_large', 413);
  }
  try {
    const value = JSON.parse(text || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new TestError('invalid_json_body', 400); }
}

export function createTestServer(workflow: {
  status(): unknown; inspect(): Promise<unknown>; setup(): Promise<unknown>;
  grant(name: ProfileName): Promise<unknown>; start(name: ProfileName, password?: string): Promise<unknown>;
}) {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.headers.origin || !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '')) throw new TestError('local_terminal_only', 403);
      const route = `${req.method} ${req.url}`;
      let result: unknown;
      if (route === 'GET /status') result = workflow.status();
      else if (route === 'GET /inspect') result = await workflow.inspect();
      else if (req.method === 'POST' && ['/setup', '/grant', '/start'].includes(req.url ?? '')) {
        const input = await body(req);
        if (req.url === '/setup') result = await workflow.setup();
        else if (req.url === '/grant') result = await workflow.grant(profileName(input.profile));
        else {
          if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 255)) throw new TestError('invalid_password_input', 400);
          result = await workflow.start(profileName(input.profile), input.password as string | undefined);
        }
      } else throw new TestError('route_not_found', 404);
      res.end(JSON.stringify(result));
    } catch (error) {
      const failure = error instanceof TestError ? error : new TestError('test_backend_error', 500);
      res.statusCode = failure.status;
      res.end(JSON.stringify({ error: failure.code, ...failure.details }));
    }
  });
}

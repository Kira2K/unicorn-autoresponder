#!/usr/local/bin/node
// No Octo/account/provider: local Linux lifecycle fixture, run with --network none.
import { createServer } from 'node:http';
import { writeFile, appendFile } from 'node:fs/promises';
const handler = async (req, res) => {
  await appendFile('/var/data/bridge/smoke-calls.jsonl', JSON.stringify({ method: req.method, path: req.url }) + '\n');
  const value = req.url === '/api/username' ? { username: 'owner@example.com' }
    : req.url === '/api/update' ? { current: '3.1.3', latest: '3.1.3', update_required: false }
    : req.url === '/internal/octo-bridge/v1/health' ? { ready: true, bridgeId: 'smoke' } : undefined;
  res.writeHead(value ? 200 : 500, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value ?? { error: 'mock_unexpected_request' }));
};
const server = createServer(handler), backend = createServer(handler);
backend.listen(4305, '127.0.0.1');
server.listen(58888, '127.0.0.1', async () => {
  await writeFile('/home/octo/.Octo Browser/local_port', '58888');
});
for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => {
  let closed = 0;
  const done = () => { if (++closed === 2) process.exit(0); };
  server.close(done); backend.close(done);
});

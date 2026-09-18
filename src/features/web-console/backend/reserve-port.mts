import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';

// Bind before creating recovering services. An occupied port must not start a second writer.
export async function reserveConsolePort(port: number, host: string) {
  let handler: RequestListener | undefined;
  const server = createServer((req, res) => {
    if (handler) return handler(req, res);
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
    res.end('{"error":"console_starting"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
  });
  return { server, attach(app: RequestListener) { handler = app; },
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

import { startTimedBackend } from './timed-server.mts';
import { TestError } from './contract.mts';

try {
  const backend = await startTimedBackend({ token: process.env.OCTO_API_TOKEN ?? '', port: Number(process.env.OCTO_TIMED_PORT ?? 58890) });
  const shutdown = () => { void backend.close().catch(() => { console.error('timed_shutdown_failed'); process.exitCode = 1; }); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  console.log(`Octo deferred-password API: http://127.0.0.1:${backend.port}`);
  console.log('Existing Alex/Bob fixtures only. 45-second grants; hide on expiry, clear after ordinary close.');
} catch (error) {
  console.error(error instanceof TestError ? error.code : 'timed_backend_start_failed'); process.exitCode = 1;
}

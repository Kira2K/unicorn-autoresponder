import { resolve } from 'node:path';
import { TestError } from './contract.mts';
import { createOctoApi } from './octo-api.mts';
import { acquireProcessLock, createFileStore } from './store.mts';
import { createWorkflow } from './workflow.mts';
import { createTestServer } from './http.mts';

async function main() {
  const token = process.env.OCTO_API_TOKEN ?? '';
  const port = Number(process.env.OCTO_TEST_PORT ?? 58889);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 58888) throw new TestError('invalid_test_port', 500);
  const api = createOctoApi(token);
  const statePath = resolve('storage/octo-access-test/state.json');
  const release = await acquireProcessLock(statePath);
  try {
    const workflow = await createWorkflow({ api, store: createFileStore(statePath) });
    const server = createTestServer(workflow);
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      server.close(() => { void release().catch(() => { process.exitCode = 1; }); });
    };
    process.once('SIGINT', close); process.once('SIGTERM', close);
    console.log(`Octo test API: http://127.0.0.1:${port}`);
    console.log('No profiles changed. POST /setup creates the test resources.');
  } catch (error) { await release(); throw error; }
}

await main().catch(error => {
  console.error(error instanceof TestError ? error.code : 'Unable to start Octo test API. Check the port, state file and filesystem permissions.');
  process.exitCode = 1;
});

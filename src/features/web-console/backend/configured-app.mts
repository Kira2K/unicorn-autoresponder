import { createRequire } from 'node:module';
import { openSqlConsole } from './postgres/runtime.mts';
import { withBridgeRoutes } from '../../octo-access/bridge/app.mts';
import { OctoError } from '../../octo-access/contracts.mts';
const { createWebConsoleApp } = createRequire(import.meta.url)('./app.ts') as {
  createWebConsoleApp(options?: import('./app.ts').WebConsoleAppOptions): import('express').Express };

export async function createConfiguredApp(env = process.env, open = openSqlConsole) {
  // Do not let an old fixture command silently start against the application DB.
  if (env.OCTO_LOCAL_CONSOLE === '1') throw new OctoError('octo_local_console_removed', 503);
  const mock = env.WEB_CONSOLE_USE_MOCK_DATA === 'true';
  const runtime = !mock && env.APP_DB === 'postgres' ? await open(env) : undefined;
  try {
    const app = withBridgeRoutes(createWebConsoleApp({ ...runtime?.options, useMockData: mock, initializeConnectionInviter: true }), runtime?.octoBridge);
    return { app, closeStorage: runtime?.close ?? (async () => {}),
      startBackground: runtime && 'startBackground' in runtime ? runtime.startBackground : async () => {} };
  } catch (error) { await runtime?.close(); throw error; }
}

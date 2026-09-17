import { createRequire } from 'node:module';
import { openSqlConsole } from './postgres/runtime.mts';
const { createWebConsoleApp } = createRequire(import.meta.url)('./app.ts') as {
  createWebConsoleApp(options?: import('./app.ts').WebConsoleAppOptions): import('express').Express };

export async function createConfiguredApp(env = process.env, open = openSqlConsole) {
  const mock = env.WEB_CONSOLE_USE_MOCK_DATA === 'true';
  const runtime = !mock && env.APP_DB === 'postgres' ? await open(env) : undefined;
  try {
    const app = createWebConsoleApp({ ...runtime?.options, useMockData: mock, initializeConnectionInviter: true });
    return { app, closeStorage: runtime?.close ?? (async () => {}) };
  } catch (error) { await runtime?.close(); throw error; }
}

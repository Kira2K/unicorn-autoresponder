import type { Express } from 'express';
import type { WorkflowAction, WorkflowResult } from './workflow-scenario.mts';
export async function serveTestApp(app: Express) {
  const server = await new Promise<ReturnType<Express['listen']>>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
export function workflowHttp(base: string, chat: string): WorkflowAction {
  return async (action, options) => {
    const a = options?.actor;
    const result = await fetch(`${base}/api/bot/telegram/chats/${chat}/resume${action === 'status' ? '/status' : action === 'reject' ? '/reject' : ''}`, {
      method: action === 'status' ? 'GET' : 'POST', headers: { 'X-Bot-Api-Token': 'sql-test-only', 'Content-Type': 'application/json',
        ...(a ? { 'X-Telegram-User-Id': a.userId, 'X-Telegram-Username': a.username ?? '',
          'X-Telegram-Chat-Id': a.chatId, 'X-Telegram-Chat-Type': a.chatType } : {}) },
      ...(action === 'status' ? {} : { body: JSON.stringify({ expectedStatus: options?.expectedStatus, comment: options?.rejectionComment }) })
    });
    const body = await result.json();
    if (!result.ok) throw Object.assign(new Error('workflow_http_error'), { code: body.error, status: result.status });
    return body as WorkflowResult;
  };
}

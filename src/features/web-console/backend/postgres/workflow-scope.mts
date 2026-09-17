import type { WebConsoleRepository } from '../types.ts';
// Only the isolated test app uses this boundary. Production visibility rules are unchanged.
export function workflowScope(repository: WebConsoleRepository, clientIds: ReadonlySet<number>): WebConsoleRepository {
  function check(id: number) {
    if (!clientIds.has(id)) throw Object.assign(new Error('CV доступно только для выбранного тестового ученика.'), { code: 'forbidden' });
  }
  return { ...repository,
    async getResumeWorkflowByTelegramChatId(chatId, options) {
      const client = await repository.findClientByTelegramChatId(chatId);
      if (!client) return null;
      check(client.id); // getResumeStatus may create a missing workflow even through GET.
      return repository.getResumeWorkflowByTelegramChatId(chatId, options);
    },
    async getResumeWorkflowById(id) {
      const workflow = await repository.getResumeWorkflowById(id);
      if (workflow) check(workflow.clientId);
      return workflow;
    },
    async getProviderResumeTasks() { return (await repository.getProviderResumeTasks()).filter(row => clientIds.has(row.clientId)); }
  };
}

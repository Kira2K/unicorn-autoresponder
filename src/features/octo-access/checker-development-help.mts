export interface CheckerDevelopmentHelp { message: string; repositoryUrl: string }
const help: CheckerDevelopmentHelp = {
  message: 'Сервис проверки прокси недоступен. Для локальной разработки установите и запустите proxy-checker из репозитория. Настройте PROXY_CHECKER_BASE_URL и UNICORN_PROXY_CHECKER_SECRET_KEY в .env.',
  repositoryUrl: 'https://github.com/Kira2K/unicorn-proxy-checker'
};

/** Opt-in by local environment/loopback URL; no development instructions on Render. */
export function createCheckerDevelopmentHelp(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch, now = Date.now) {
  if (env.NODE_ENV === 'production' || env.RENDER) return undefined;
  const baseUrl = env.PROXY_CHECKER_BASE_URL;
  if (baseUrl) {
    try { if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)) return undefined; }
    catch { return undefined; }
  }
  let cached: CheckerDevelopmentHelp | undefined, expiresAt = 0;
  let pending: Promise<CheckerDevelopmentHelp | undefined> | undefined;
  return async (): Promise<CheckerDevelopmentHelp | undefined> => {
    if (!baseUrl || !env.UNICORN_PROXY_CHECKER_SECRET_KEY) return { ...help };
    if (expiresAt > now()) return cached && { ...cached };
    if (!pending) pending = (async () => {
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
        cached = response.ok ? undefined : help;
      } catch { cached = help; }
      expiresAt = now() + (cached ? 10_000 : 30_000);
      return cached && { ...cached };
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

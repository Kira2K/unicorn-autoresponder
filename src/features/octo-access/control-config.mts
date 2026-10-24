import { OctoError } from './contracts.mts';

export interface ControlConfig { secret: string; url?: string }

// The URL is an operator-configured origin, never browser/user input.
export function readControlConfig(env: NodeJS.ProcessEnv): ControlConfig | undefined {
  const secret = env.OCTO_CONTROL_SECRET ?? '', raw = env.OCTO_CONTROL_URL;
  if (!secret && !raw) return;
  const invalid = () => new OctoError('octo_control_configuration_required', 503);
  if (secret.length < 32 || /\s/.test(secret)) throw invalid();
  if (!raw) return { secret };
  let url: URL;
  try { url = new URL(raw); } catch { throw invalid(); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') throw invalid();
  return { secret, url: url.origin };
}

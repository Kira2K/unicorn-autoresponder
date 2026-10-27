import { fail } from './settings.mjs';

export async function inspectOwner(port, settings, fetchImpl) {
  const read = async path => {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/${path}`, { signal: AbortSignal.timeout(5_000) });
    const data = await response.json();
    if (!response.ok) throw fail('bridge_render_octo_unavailable');
    return data;
  };
  const owner = await read('username');
  if (typeof owner.username !== 'string') throw fail('bridge_render_octo_unavailable');
  if (owner.username.toLowerCase() !== settings.config.ownerEmail) throw fail('bridge_wrong_owner');
  const version = await read('update');
  if (!/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9]+)*$/.test(version.current ?? '')
    || typeof version.update_required !== 'boolean') throw fail('bridge_render_version_unverified');
  if (settings.mode === 'worker' && (version.current !== '3.1.3' || version.update_required))
    throw fail('bridge_render_octo_version_requires_review');
  return { ownerVerified: true, octoVersion: version.current, updateRequired: version.update_required };
}

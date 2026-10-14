import type { ManagedProfile, ProfileDeletion } from './contracts.mts';
import type { ProxySetup } from './onboarding-contracts.mts';

export const isDeletionEvent = (action: string) => action === 'profiles.trashed' || action === 'profiles.deleted';
export const initialDeletion = (eventId: string): ProfileDeletion => ({ eventId, phase: 'verify', attempts: 0, nextAttemptAt: 0 });
export const setupUsesProfile = (setup: ProxySetup | undefined, profile: ManagedProfile) => !!setup &&
  (setup.profileIds?.includes(profile.id) || profile.createdAt >= setup.createdAt);
export const upstreamNotFound = (error: unknown) => {
  const details = (error as { details?: Record<string, unknown> })?.details;
  return details?.httpStatus === 404 && details.upstreamCode === 'not_found';
};
export const transientOctoError = (error: unknown) => {
  const e = error as { code?: string; details?: { httpStatus?: number } };
  const status = e?.details?.httpStatus;
  return e?.code === 'octo_request_outcome_unknown' || status === 408 || status === 429 || (status !== undefined && status >= 500);
};

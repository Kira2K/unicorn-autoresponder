/** Read only native Bot API error metadata; never inspect or log response text. */
export function telegramErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const failure = error as { details?: { data?: { error_code?: unknown } }; response?: {error_code?: unknown}; error_code?: unknown };
  const code = failure.details?.data?.error_code ?? failure.response?.error_code ?? failure.error_code;
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : undefined;
}

/** Native Bot API FloodWait and our local defer signal. Never parse error descriptions. */
export function retryDelayMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const failure = error as {code?:unknown;retryAfterMs?:unknown;details?:{data?:{parameters?:{retry_after?:unknown}}};
    response?:{parameters?:{retry_after?:unknown}};parameters?:{retry_after?:unknown}};
  if (failure.code === 'mentor_flood_wait' && typeof failure.retryAfterMs === 'number' && Number.isFinite(failure.retryAfterMs))
    return Math.max(1,Math.ceil(failure.retryAfterMs));
  if (telegramErrorCode(error) !== 429) return undefined;
  const seconds = failure.details?.data?.parameters?.retry_after ?? failure.response?.parameters?.retry_after ?? failure.parameters?.retry_after;
  return typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, seconds * 1000) : 60_000;
}

export function configurationFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return code === 'telegram_bot_token_missing' || [401, 404, 409].includes(telegramErrorCode(error) ?? 0);
}

export function commitUncertain(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const failure = current as { message?: unknown; cause?: unknown };
    if (failure.message === 'mentor_commit_uncertain') return true;
    current = failure.cause;
  }
  return false;
}

/** Preserve actionable, bounded identifiers without copying SQL, messages or credentials. */
export function storageFailureCode(error: unknown): string {
  let current = error, code = 'mentor_transaction_failed';
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof value.code === 'string' && /^[0-9A-Z]{5}$/.test(value.code)) code = 'postgres_' + value.code;
    else if (typeof value.message === 'string' && /^mentor_[a-z_]{1,80}$/.test(value.message)) code = value.message;
    current = value.cause;
  }
  return code;
}

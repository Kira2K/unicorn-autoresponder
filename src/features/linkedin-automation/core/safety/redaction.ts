export const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'access_token',
  'premium_access_token',
  'api_key',
  'x-api-key',
  'authorization',
  'cookie',
  'password',
  'proxy_password',
  'totp_secret',
  'totp',
  'otp',
  '2fa_code',
  'verification_code',
]);

function normalizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/** Returns a redacted copy suitable for logs and reports. */
export function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactObject);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactObject(nestedValue),
    ]),
  );
}

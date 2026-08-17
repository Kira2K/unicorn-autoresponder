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
  'client_secret',
  'proxy_username',
]);

function normalizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

const SECRET_TEXT_PATTERNS: RegExp[] = [
  /\bBearer\s+[^\s,;]+/gi,
  /\b(li_at|access_token|premium_access_token|api_key|x-api-key|authorization|cookie|password|proxy_password|totp_secret|totp|otp|2fa_code|verification_code|client_secret)\b\s*[:=]\s*[^\s,;]+/gi,
];

/** Redacts credentials accidentally embedded in otherwise safe log messages. */
export function redactText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce(
    (safe, pattern) => safe.replace(pattern, match => {
      if (/^Bearer\s/i.test(match)) return `Bearer ${REDACTED}`;
      const separator = match.includes('=') ? '=' : ':';
      return `${match.split(/[:=]/, 1)[0]}${separator}${REDACTED}`;
    }),
    value,
  );
}

/** Returns a redacted copy suitable for logs and reports. */
export function redactObject(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function visit(current: unknown, parentKey?: string): unknown {
    if (typeof current === 'string') return redactText(current);
    if (current === null || typeof current !== 'object') return current;
    if (seen.has(current)) return '[Circular]';
    seen.add(current);

    if (current instanceof Error) {
      return {
        name: redactText(current.name),
        message: redactText(current.message),
      };
    }

    if (Array.isArray(current)) {
      return current.map(item => visit(item, parentKey));
    }

    const normalizedParent = parentKey ? normalizeKey(parentKey) : '';
    return Object.fromEntries(
      Object.entries(current).map(([key, nestedValue]) => {
        const proxyUsername = normalizeKey(key) === 'username' &&
          (normalizedParent === 'proxy' || normalizedParent === 'custom_proxy');
        return [
          key,
          isSensitiveKey(key) || proxyUsername ? REDACTED : visit(nestedValue, key),
        ];
      }),
    );
  }

  return visit(value);
}

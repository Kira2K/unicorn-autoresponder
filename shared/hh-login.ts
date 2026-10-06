// HH password login accepts an email address or a phone number from account.login.
function hhLoginKind(value: unknown): 'email' | 'phone' | null {
  const login = String(value ?? '').trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) return 'email'
  if (/^\+?[\d\s().-]+$/.test(login) && /^\d{6,15}$/.test(login.replace(/\D/g, ''))) return 'phone'
  return null
}

module.exports = { hhLoginKind }

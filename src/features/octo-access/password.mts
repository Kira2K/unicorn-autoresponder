import { randomInt } from 'node:crypto';
export function generateProfilePassword(draw: () => number = () => randomInt(0, 100_000)): string {
  const value = draw();
  if (!Number.isInteger(value) || value < 0 || value >= 100_000) throw new Error('invalid_password_draw');
  return String(value).padStart(5, '0');
}

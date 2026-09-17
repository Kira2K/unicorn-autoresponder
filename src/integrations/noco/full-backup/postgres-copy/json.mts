import { createHash } from 'node:crypto';
import type { Json } from './contracts.mts';
type ExtendedJSON = typeof JSON & { rawJSON(value: string): Json; isRawJSON(value: unknown): boolean };
const extended = JSON as ExtendedJSON;
export function parse(text: string): Json {
  return JSON.parse(text, ((_key: string, value: Json, context?: { source?: string }) =>
    typeof value === 'number' && context?.source && context.source !== JSON.stringify(value)
      ? extended.rawJSON(context.source) : value) as Parameters<typeof JSON.parse>[1]);
}
export function canonical(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (extended.isRawJSON(item)) return item;
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => [key, ordered(val)]));
    return item;
  }
  return JSON.stringify(ordered(value));
}
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function scalar(value: Json): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || extended.isRawJSON(value)) return canonical(value);
  throw new Error('invalid_record_id');
}

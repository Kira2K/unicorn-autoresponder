// Native Node 24 can expose a CJS module differently after require() and import().
// The default export is the actual module.exports object in both load orders.
export function commonJsExports<T>(namespace: unknown): T {
  return ((namespace as { default?: unknown }).default ?? namespace) as T
}

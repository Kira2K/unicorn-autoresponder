// Only the equality queries used by the old adapters. Independent of SQL helpers.
export function legacyFixtureRows(rows: Record<string, unknown>[], where?: string) {
  if (!where) return structuredClone(rows);
  const terms = where.split('~or').map(term => {
    const parts = term.slice(1, -1).split(',');
    if (!term.startsWith('(') || !term.endsWith(')') || parts[1] !== 'eq')
      throw Error('unsupported legacy fixture query');
    return { key: parts[0], value: parts.slice(2).join(',') };
  });
  return structuredClone(rows.filter(row => terms.some(t => String(row[t.key] ?? '').trim() === t.value)));
}

import type { Reader, Row, Page } from './contracts.mts';
import { scalar, canonical } from './json.mts';
export async function* readPages(reader: Reader, path: string, key: string | string[],
  extra: Record<string, string> = {}, enforceOrder = true): AsyncGenerator<Row[]> {
  const keys = typeof key === 'string' ? [key] : key;
  let offset = 0, previous: string[] | undefined;
  const seen = new Set<string>();
  for (;;) {
    const page = await reader.get<Page>(path, { ...extra, sort: keys.join(','), limit: '100', offset: String(offset) });
    const rows = page.list ?? page.data;
    if (!Array.isArray(rows)) throw new Error('invalid_page');
    for (const row of rows) {
      if (keys.some(k => !(k in row))) throw new Error('missing_record_id');
      const parts = keys.map(k => scalar(row[k]));
      const id = canonical(parts);
      if (seen.has(id)) throw new Error('duplicate_record_id');
      if (enforceOrder && previous && parts.every(p => /^\d+$/.test(p)) && previous.every(p => /^\d+$/.test(p))) {
        const different = parts.findIndex((p, i) => BigInt(p) !== BigInt(previous![i]));
        if (different < 0 || BigInt(parts[different]) < BigInt(previous[different])) throw new Error('unstable_id_order');
      }
      seen.add(id); previous = parts;
    }
    offset += rows.length;
    if (rows.length) yield rows;
    const last = page.pageInfo?.isLastPage;
    if (last === true || (last === undefined && rows.length < 100)) {
      if (page.pageInfo?.totalRows !== undefined && Number(page.pageInfo.totalRows) !== offset)
        throw new Error('page_total_changed');
      return;
    }
    if (!rows.length) throw new Error('empty_unfinished_page');
  }
}

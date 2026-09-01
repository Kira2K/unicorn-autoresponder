type Column = { title?: string; column_name?: string; unique?: unknown; un?: unknown }

const list = (value: any): Column[] => Array.isArray(value) ? value : value?.list ?? value?.data ?? []

function enabled(value: unknown) {
  return value === true || value === 1 || value === '1'
}

export function requiredUniqueColumns(columns: ReadonlyArray<Column>) {
  return columns.filter(column => enabled(column.unique))
    .map(column => String(column.title ?? column.column_name))
}

export function missingUniqueColumns(meta: any, columns: ReadonlyArray<Column>) {
  const actual = new Map(list(meta?.columns).map(column =>
    [String(column.title ?? column.column_name), column]))
  return requiredUniqueColumns(columns).filter(title => {
    const column = actual.get(title)
    return !column || (!enabled(column.unique) && !enabled(column.un))
  })
}

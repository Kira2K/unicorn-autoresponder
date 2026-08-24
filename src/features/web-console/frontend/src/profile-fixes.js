const clone = value => JSON.parse(JSON.stringify(value))
const parts = path => path.match(/[^.[\]]+/g) || []

export function readProfilePath(document, path) {
  return parts(path).reduce((value, part) => value?.[part], document)
}

export function applyProfileFixes(document, fixes) {
  const next = clone(document)
  const ordered = [...fixes].sort((left, right) =>
    right.path.localeCompare(left.path, undefined, { numeric: true }))
  for (const fix of ordered) {
    const path = parts(fix.path)
    const key = path.pop()
    const parent = path.reduce((value, part) => value?.[part], next)
    if (!parent || key === undefined) continue
    if (fix.remove && Array.isArray(parent)) parent.splice(Number(key), 1)
    else parent[key] = fix.value
  }
  return next
}

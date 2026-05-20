export type BlockedCompany = {
  id: string
  name: string
}

export type BlockedCompanyMatch = {
  blockedCompany: BlockedCompany
  checkedCompanyName: string
  normalizedCheckedName: string
  normalizedBlockedName: string
  reason: 'exact' | 'substring' | 'edit_distance_1'
  distance?: number
}

function normalizeCompanyName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactCompanyName(value: unknown): string {
  return normalizeCompanyName(value).replace(/\s+/g, '')
}

function getEditDistanceAtMostOne(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  if (Math.abs(left.length - right.length) > 1) {
    return 2
  }

  let edits = 0
  let leftIndex = 0
  let rightIndex = 0

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }

    edits += 1

    if (edits > 1) {
      return edits
    }

    if (left.length > right.length) {
      leftIndex += 1
    } else if (right.length > left.length) {
      rightIndex += 1
    } else {
      leftIndex += 1
      rightIndex += 1
    }
  }

  if (leftIndex < left.length || rightIndex < right.length) {
    edits += 1
  }

  return edits
}

function normalizeBlockedCompanies(
  blockedCompanies: unknown
): BlockedCompany[] {
  if (!Array.isArray(blockedCompanies)) {
    return []
  }

  return blockedCompanies
    .map((company: unknown) => {
      if (!company || typeof company !== 'object') {
        return undefined
      }

      const candidate = company as { id?: unknown; name?: unknown }
      const id = String(candidate.id ?? '').trim()
      const name = String(candidate.name ?? '').trim()

      if (!id || !name) {
        return undefined
      }

      return { id, name }
    })
    .filter((company): company is BlockedCompany => Boolean(company))
}

function findBlockedCompanyMatch(
  companyName: unknown,
  blockedCompanies: unknown
): BlockedCompanyMatch | undefined {
  const checkedCompanyName = String(companyName ?? '').trim()
  const normalizedCheckedName = compactCompanyName(checkedCompanyName)

  if (!normalizedCheckedName) {
    return undefined
  }

  for (const blockedCompany of normalizeBlockedCompanies(blockedCompanies)) {
    const normalizedBlockedName = compactCompanyName(blockedCompany.name)

    if (!normalizedBlockedName) {
      continue
    }

    if (normalizedCheckedName === normalizedBlockedName) {
      return {
        blockedCompany,
        checkedCompanyName,
        normalizedCheckedName,
        normalizedBlockedName,
        reason: 'exact',
        distance: 0
      }
    }

    const shorter =
      normalizedCheckedName.length < normalizedBlockedName.length
        ? normalizedCheckedName
        : normalizedBlockedName
    const longer =
      normalizedCheckedName.length < normalizedBlockedName.length
        ? normalizedBlockedName
        : normalizedCheckedName

    if (shorter.length >= 3 && longer.includes(shorter)) {
      return {
        blockedCompany,
        checkedCompanyName,
        normalizedCheckedName,
        normalizedBlockedName,
        reason: 'substring'
      }
    }

    if (
      normalizedCheckedName.length >= 3 &&
      normalizedBlockedName.length >= 3
    ) {
      const distance = getEditDistanceAtMostOne(
        normalizedCheckedName,
        normalizedBlockedName
      )

      if (distance <= 1) {
        return {
          blockedCompany,
          checkedCompanyName,
          normalizedCheckedName,
          normalizedBlockedName,
          reason: 'edit_distance_1',
          distance
        }
      }
    }
  }

  return undefined
}

function createCompanyStopListBrowserSource(): string {
  return `
;(function installCompanyStopListMatcher(global) {
  const normalizeCompanyName = ${normalizeCompanyName.toString()};
  const compactCompanyName = ${compactCompanyName.toString()};
  const getEditDistanceAtMostOne = ${getEditDistanceAtMostOne.toString()};
  const normalizeBlockedCompanies = ${normalizeBlockedCompanies.toString()};
  const findBlockedCompanyMatch = ${findBlockedCompanyMatch.toString()};

  global.HHCompanyStopList = {
    findBlockedCompanyMatch,
    normalizeBlockedCompanies,
    normalizeCompanyName
  };
})(window);
`
}

module.exports = {
  compactCompanyName,
  createCompanyStopListBrowserSource,
  findBlockedCompanyMatch,
  getEditDistanceAtMostOne,
  normalizeBlockedCompanies,
  normalizeCompanyName
}

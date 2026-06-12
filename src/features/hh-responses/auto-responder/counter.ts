const { getVacancyIdFromUrl } = require('../shared/hh-url.ts')

type ResponseCounter = import('../orchestrator/types.ts').ResponseCounter

function createResponseCounter(): ResponseCounter {
  return {
    vacancyIds: new Set<string>()
  }
}

function recordVacancyTransition(counter: ResponseCounter, url: string): void {
  const vacancyId = getVacancyIdFromUrl(url)

  if (vacancyId) {
    counter.vacancyIds.add(vacancyId)
  }
}

module.exports = {
  createResponseCounter,
  recordVacancyTransition
}

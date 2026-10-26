import assert from 'node:assert/strict'
import { calculateLegendBirthDate } from '../legend-birth-date.ts'
import { ProfileFillerError } from '../errors.ts'

export function runLegendBirthDateTests() {
  const today = new Date('2026-10-23T12:00:00Z')
  const calculate = (...dates: Array<string | undefined>) =>
    calculateLegendBirthDate(dates.map(startDate => ({ startDate })), today)

  assert.equal(calculate('03/2023', '06/2018', '09/2020'), '2000-06-01')
  assert.equal(calculate('06/2018', '06/2018'), '2000-06-01')
  for (const date of ['2018-06', '06.2018', '6/2018']) {
    assert.equal(calculate(date), '2000-06-01', date)
  }
  assert.equal(calculate('2018'), '2000-01-01')
  for (const date of ['2018-06-15', '15.06.2018', '15/06/2018']) {
    assert.equal(calculate(date), '2000-06-15', date)
  }
  assert.equal(calculate('2020-02-29'), '2002-02-28')
  assert.equal(calculate('2026-10-23'), '2008-10-23')
  assert.equal(calculateLegendBirthDate([{ startDate: '06/2018' }],
    new Date('2027-10-23T12:00:00Z')), '2000-06-01',
  'The birth date must remain stable across repeated fills and calendar years')

  for (const dates of [[], [undefined], [''], ['present'], ['2018–2020'],
    ['13/2018'], ['00/2018'], ['2019-02-29'], ['31.04.2018'],
    ['06/2018', undefined], ['06/2018', 'unknown'], ['06/2018', '11/2026'],
    ['2026-10-24'], ['1800'], ['1910']] as Array<Array<string | undefined>>) {
    assert.throws(() => calculate(...dates), (error: unknown) =>
      error instanceof ProfileFillerError && error.code === 'profile_legend_birth_date_unavailable' &&
      error.stage === 'prepare_profile', JSON.stringify(dates))
  }

  const entries = Object.freeze([Object.freeze({ startDate: '06/2018' }),
    Object.freeze({ startDate: '01/2023' })])
  assert.equal(calculateLegendBirthDate(entries, today), '2000-06-01')
}

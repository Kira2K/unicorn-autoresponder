// One taxonomy for both the HH writer and persisted-content checks.
export function educationLevel(value = ''): string | undefined {
  const rules: Array<[string, RegExp]> = [
    ['master', /магистр|master/i], ['bachelor', /бакалавр|bachelor/i],
    ['candidate', /кандидат|candidate/i], ['doctor', /доктор|doctor|ph\.?d/i],
    ['unfinished_higher', /неокончен|unfinished/i],
    ['special_secondary', /среднее специаль|vocational/i],
    ['secondary', /среднее|secondary/i], ['higher', /специалист|специалитет|высшее|specialist|higher/i]
  ]
  return rules.find(([, pattern]) => pattern.test(value))?.[0]
}

export function educationDegreeMatches(actual: string, expected?: string): boolean {
  if (!expected) return true
  const level = educationLevel(expected)
  return level ? educationLevel(actual) === level :
    actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
}

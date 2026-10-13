import assert from 'node:assert/strict'
import { hhLanguageUiName, resolveProfileLanguages } from '../language-policy.ts'

export function runLanguagePolicyTests() {
  assert.deepEqual(resolveProfileLanguages({
    cvLanguages: [{ name: 'English', level: 'C1 — Advanced' },
      { name: 'German', level: '' }, { name: 'Serbian', level: 'B1' }],
    profileLanguage: 'en', databaseEnglishLevel: 'B2'
  }), [{ name: 'English', level: 'C1' }, { name: 'Serbian', level: 'B1' }])
  assert.deepEqual(resolveProfileLanguages({
    cvLanguages: [], profileLanguage: 'ru', databaseEnglishLevel: undefined
  }), [{ name: 'Английский', level: 'B2' }])
  assert.equal(hhLanguageUiName('English'), 'Английский')
  assert.equal(hhLanguageUiName('Serbian'), 'Сербский')
}

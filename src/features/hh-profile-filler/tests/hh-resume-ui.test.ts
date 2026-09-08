import assert from 'node:assert/strict'
import { chooseFirstSuggestion, openProfessionEditor,
  professionForTitle, SAVE_AND_CONTINUE_PATTERNS, specializationForStack } from '../hh-resume-ui.ts'
import { formatProfileFillerReport } from '../reporter.ts'

function hiddenLocator(): any {
  const locator: any = {
    count: async () => 0,
    nth: () => locator,
    first: () => locator,
    last: () => locator,
    filter: () => locator,
    getByText: () => locator,
    isVisible: async () => false,
    waitFor: async () => undefined
  }
  return locator
}

export async function runHHResumeUiTests() {
  assert.equal(SAVE_AND_CONTINUE_PATTERNS.some(pattern =>
    pattern.test('Сохранить и\u00a0продолжить')), true)
  assert.deepEqual(specializationForStack('FullStack', 'Ru'), {
    query: 'разработчик', label: 'Программист, разработчик'
  })
  assert.deepEqual(specializationForStack('Manual QA', 'En'), {
    query: 'tester', label: 'Tester'
  })
  assert.equal(professionForTitle(
    'Старший Fullstack разработчик / Senior Fullstack Developer', 'Ru'),
  'Старший фуллстэк разработчик')
  assert.equal(professionForTitle(
    'Старший Backend разработчик / Senior Backend Developer', 'Ru'),
  'Старший бэкенд разработчик')
  assert.equal(professionForTitle(
    'Старший Frontend разработчик / Senior Frontend Developer', 'En'),
  'Senior Frontend Developer')

  let editorVisible = false
  let entryClicked = 0
  let filled = ''
  const input: any = {
    count: async () => editorVisible ? 1 : 0,
    nth: () => input,
    isVisible: async () => editorVisible,
    fill: async (value: string) => { filled = value }
  }
  const entry: any = {
    count: async () => editorVisible ? 0 : 1,
    nth: () => entry,
    isVisible: async () => !editorVisible,
    click: async () => { entryClicked += 1; editorVisible = true }
  }
  const page: any = {
    locator: (selector: string) => selector === '[data-qa="resume-profile-position-input"]'
      ? input : hiddenLocator(),
    getByLabel: () => hiddenLocator(),
    getByPlaceholder: () => hiddenLocator(),
    getByText: (pattern: RegExp) => pattern.test('Укажу профессию') ? entry : hiddenLocator(),
    waitForTimeout: async () => undefined
  }

  const result = await openProfessionEditor(page)
  await result.fill('Backend-разработчик')
  assert.equal(entryClicked, 1)
  assert.equal(filled, 'Backend-разработчик')

  entryClicked = 0
  editorVisible = true
  await openProfessionEditor(page)
  assert.equal(entryClicked, 0)

  let optionClicked = 0
  const option: any = {
    count: async () => 1,
    nth: () => option,
    last: () => option,
    isVisible: async () => true,
    click: async () => { optionClicked += 1 }
  }
  const suggestionPage: any = {
    waitForTimeout: async () => undefined,
    getByText: () => ({ last: () => hiddenLocator() }),
    locator: (selector: string) => {
      if (selector === '[data-qa="bottom-sheet-css-variables"]:visible') {
        return { getByText: () => ({ last: () => option }) }
      }
      return hiddenLocator()
    }
  }
  assert.equal(await chooseFirstSuggestion(suggestionPage,
    'Старший фуллстэк разработчик'), true)
  assert.equal(optionClicked, 1)

  const report = formatProfileFillerReport({
    ok: false,
    dryRun: false,
    clientId: 170,
    clientName: 'Аблена Дементьева',
    market: 'Ru',
    stage: 'fill_resume',
    message: 'x'.repeat(10_000)
  })
  assert.ok(report.length <= 3900)
  assert.equal(report, '🐈‍⬛⚠️ HH Profile Filler\nНе получилось заполнить.')
  assert.doesNotMatch(report, /170|Аблена|fill_resume/)
}

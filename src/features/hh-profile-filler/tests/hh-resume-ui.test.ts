import assert from 'node:assert/strict'
import { chooseFirstSuggestion, INITIAL_HH_PROFESSION, openProfessionEditor,
  nextWizardStep, professionForTitle, SAVE_AND_CONTINUE_PATTERNS,
  specializationForStack } from '../hh-resume-ui.ts'
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
    query: 'разработчик', label: 'Программист, разработчик'
  })
  assert.deepEqual(specializationForStack('Java', 'En'), {
    query: 'разработчик', label: 'Программист, разработчик'
  })
  assert.equal(INITIAL_HH_PROFESSION, 'Программист, разработчик')
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

  let submitClicks = 0
  let screenReads = 0
  const continueButton: any = {
    last: () => continueButton,
    isVisible: async () => true,
    click: async () => { submitClicks += 1 }
  }
  const screen: any = {
    first: () => screen,
    getAttribute: async () => {
      screenReads += 1
      return screenReads > 3 ? 'resume-profile-screen-education' :
        'resume-profile-screen-common'
    }
  }
  const body: any = { innerText: async () => 'Заполните основную информацию' }
  const transitionPage: any = {
    url: () => 'https://hh.ru/profile/resume/common?resume=draft',
    locator: (selector: string) => selector === 'body' ? body : screen,
    getByText: () => continueButton,
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined
  }
  await nextWizardStep(transitionPage, 'personal information')
  assert.equal(submitClicks, 1)

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
  assert.ok(report.startsWith(
    '⚠️ HH Profile Filler\nНе получилось заполнить Аблена Дементьева\nПричина: '))
  assert.equal(report.length, 3900)
  assert.doesNotMatch(report, /170|fill_resume/)

  const redactedReport = formatProfileFillerReport({
    ok: false,
    dryRun: false,
    clientId: 92,
    clientName: 'Галина   Фокина',
    market: 'En',
    stage: 'authenticate',
    code: 'auth_unknown',
    message: 'HH auth validation\nstayed unknown; password=secret'
  })
  assert.equal(redactedReport,
    '⚠️ HH Profile Filler\nНе получилось заполнить Галина Фокина\n' +
    'Причина: HH auth validation stayed unknown; password=[REDACTED]')
  assert.doesNotMatch(redactedReport, /92|authenticate|auth_unknown|secret/)
}

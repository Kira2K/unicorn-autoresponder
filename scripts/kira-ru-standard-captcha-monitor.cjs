#!/usr/bin/env node

const childProcess = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LOG_DIR = path.join(ROOT, 'logs')
const CAPTCHA_DIR = path.join(LOG_DIR, 'captcha')
const CLIENT_NAME = '\u041a\u0438\u0440\u0430'
const MARKET = 'Ru'
const PROFILE_ID = 770032142
const RUN_STARTED_AT = Date.now()

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function makeRunEnv() {
  const env = { ...process.env }

  env.APP_DB = 'noco'
  env.ORCHESTRATOR_SUPERVISED = 'true'
  env.ORCHESTRATOR_CONCURRENCY = '3'
  env.ORCHESTRATOR_RESPONSE_LIMIT = '120'
  env.ORCHESTRATOR_WATCH_MS = '7200000'
  env.ORCHESTRATOR_IDLE_TIMEOUT_MS = '600000'
  env.ORCHESTRATOR_WORK_WITH_MARKET = MARKET
  env.ORCHESTRATOR_CLIENT_NAMES = CLIENT_NAME
  env.DOLPHIN_KEEP_PROFILE_OPEN_AFTER_RUN = 'false'

  delete env.ORCHESTRATOR_CLIENT_IDS
  delete env.ORCHESTRATOR_EXCLUDE_CLIENT_IDS
  delete env.ORCHESTRATOR_EXCLUDE_CLIENT_NAMES
  delete env.ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES

  return env
}

function parseJsonObject(stdout) {
  const text = String(stdout || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start < 0 || end < start) {
    throw new Error(`No JSON object found in output: ${text}`)
  }

  return JSON.parse(text.slice(start, end + 1))
}

function runReadiness(env) {
  const result = childProcess.spawnSync(
    process.execPath,
    [
      'src/integrations/noco/hh-response-readiness/index.ts',
      '--market=ru',
      `--client-names=${CLIENT_NAME}`,
      '--json'
    ],
    {
      cwd: ROOT,
      env,
      encoding: 'utf8'
    }
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `Readiness failed with code ${result.status}: ${result.stderr || result.stdout}`
    )
  }

  const readiness = parseJsonObject(result.stdout)
  const kira = (readiness.results || []).find(
    item =>
      item.clientName === CLIENT_NAME &&
      item.market === MARKET &&
      Number(item.dolphinProfileId) === PROFILE_ID
  )

  if (!kira || readiness.ready !== 1 || readiness.blocked !== 0) {
    throw new Error(
      `Kira/Ru is not ready: ${JSON.stringify(readiness, null, 2)}`
    )
  }

  console.log(
    `[preflight] readiness ok: ${kira.clientName}/${kira.market}, profile ${kira.dolphinProfileId}`
  )
}

function getActiveOrchestrators() {
  const command = [
    "Get-CimInstance Win32_Process",
    "| Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'hh-responses|orchestrator\\\\.ts|npm.*orchestrator' }",
    '| Select-Object ProcessId,Name,CommandLine',
    '| ConvertTo-Json -Depth 4'
  ].join(' ')
  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      cwd: ROOT,
      encoding: 'utf8'
    }
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `Active orchestrator check failed: ${result.stderr || result.stdout}`
    )
  }

  const text = String(result.stdout || '').trim()
  if (!text) {
    return []
  }

  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function runDolphinHealthCheck() {
  const { assertDolphinAppRunning } = require('../src/integrations/dolphin/preflight.ts')

  await assertDolphinAppRunning()
}

async function listFreshRunLogs() {
  await fsp.mkdir(LOG_DIR, { recursive: true })
  const names = await fsp.readdir(LOG_DIR)
  const logs = []

  for (const name of names) {
    if (!/^orchestrator-run-.*\.jsonl$/i.test(name)) {
      continue
    }

    const fullPath = path.join(LOG_DIR, name)
    const stat = await fsp.stat(fullPath).catch(() => undefined)
    if (!stat || stat.mtimeMs < RUN_STARTED_AT - 5000) {
      continue
    }

    logs.push({ fullPath, mtimeMs: stat.mtimeMs })
  }

  return logs.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function readJsonl(filePath) {
  const text = await fsp.readFile(filePath, 'utf8').catch(() => '')
  const records = []

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    try {
      records.push(JSON.parse(line))
    } catch {
      // Ignore partially written JSONL lines while the orchestrator is active.
    }
  }

  return records
}

function getDolphinPort(records) {
  for (const record of records) {
    if (
      record.kind !== 'client-lifecycle' ||
      record.clientName !== CLIENT_NAME ||
      record.market !== MARKET ||
      Number(record.dolphinProfileId) !== PROFILE_ID
    ) {
      continue
    }

    const event = record.event || {}
    if (event.event !== 'Dolphin profile started') {
      continue
    }

    const match = String(event.details || '').match(/\bport\s+(\d+)\b/i)
    if (match) {
      return Number(match[1])
    }
  }

  return undefined
}

function getFinalStatus(records) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    const status = record.status

    if (
      record.kind === 'client-final-status' &&
      status?.clientName === CLIENT_NAME &&
      status?.market === MARKET &&
      Number(status?.dolphinProfileId) === PROFILE_ID
    ) {
      return status
    }
  }

  return undefined
}

async function getRunLogSnapshot() {
  const logs = await listFreshRunLogs()

  for (const log of logs) {
    const records = await readJsonl(log.fullPath)
    const hasKira = records.some(record => {
      return (
        record.clientName === CLIENT_NAME ||
        record.status?.clientName === CLIENT_NAME
      )
    })

    if (hasKira) {
      return { logPath: log.fullPath, records }
    }
  }

  return logs[0] ? { logPath: logs[0].fullPath, records: await readJsonl(logs[0].fullPath) } : undefined
}

async function detectCaptcha(page) {
  return await page.evaluate(() => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
    const visible = element => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }
    const bodyText = normalize(document.body?.innerText || '')
    const title = document.title || ''
    const url = location.href
    const captchaText =
      /captcha|капч|текст с картинки|text from (the )?image|enter the text|characters from/i.test(bodyText)
    const captchaInput = Array.from(document.querySelectorAll('input, textarea')).some(input => {
      const text = [
        input.getAttribute('placeholder'),
        input.getAttribute('aria-label'),
        input.getAttribute('name'),
        input.getAttribute('id')
      ].map(normalize).join(' ')

      return visible(input) && /captcha|капч|текст с картинки|text from image|characters|code/i.test(text)
    })
    const ddosGuard = /^ddos-guard$/i.test(title) || /\bddos-guard\b/i.test(bodyText)
    const englishLike =
      /pass the captcha|enter the text from (the )?image|text from (the )?image|invalid text|please try again|please confirm that you are not a robot|submit/i.test(bodyText)
    const russianLike = /пройдите капчу|текст с картинки|капч/i.test(bodyText)

    return {
      bodyPreview: bodyText.slice(0, 500),
      captchaInput,
      captchaText,
      ddosGuard,
      englishLike,
      isCaptcha: captchaText || captchaInput || ddosGuard || /captcha/i.test(url),
      russianLike,
      title,
      url
    }
  })
}

async function clickEnglishSwitch(page) {
  return await page.evaluate(() => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
    const visible = element => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }
    const candidates = Array.from(
      document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')
    )
    const readText = element => normalize(
      element.textContent ||
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('value')
    )
    const exact = candidates.find(element => {
      if (!visible(element)) {
        return false
      }

      const text = readText(element)
      return /^english$/i.test(text) || /^en$/i.test(text)
    })

    if (exact) {
      exact.click()
      return { clicked: true, text: readText(exact) }
    }

    for (const element of candidates) {
      if (!visible(element)) {
        continue
      }

      const text = readText(element)

      if (!/\benglish\b|\ben\b|англ/i.test(text)) {
        continue
      }

      element.click()

      return { clicked: true, text }
    }

    return { clicked: false }
  })
}

async function captchaClip(page) {
  return await page.evaluate(() => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim()
    const visible = element => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }
    const anchors = []
    const push = element => {
      if (element && visible(element)) {
        anchors.push(element)
      }
    }

    for (const input of document.querySelectorAll('input, textarea')) {
      const text = [
        input.getAttribute('placeholder'),
        input.getAttribute('aria-label'),
        input.getAttribute('name'),
        input.getAttribute('id')
      ].map(normalize).join(' ')

      if (/captcha|капч|текст с картинки|text from image|characters|code/i.test(text)) {
        push(input)
      }
    }

    for (const element of document.querySelectorAll('img, canvas, svg')) {
      const rect = element.getBoundingClientRect()
      const text = [
        element.getAttribute('alt'),
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('src'),
        element.id,
        element.className
      ].map(normalize).join(' ')

      if (
        rect.width >= 50 &&
        rect.height >= 20 &&
        (/captcha|капч|image|code/i.test(text) || anchors.length)
      ) {
        push(element)
      }
    }

    for (const element of document.querySelectorAll('label, p, div, span, h1, h2, h3')) {
      const text = normalize(element.textContent)

      if (
        text.length <= 220 &&
        /captcha|капч|текст с картинки|text from (the )?image|enter the text|characters from/i.test(text)
      ) {
        push(element)
      }
    }

    if (!anchors.length) {
      return undefined
    }

    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity

    for (const element of anchors) {
      const rect = element.getBoundingClientRect()
      left = Math.min(left, rect.left)
      top = Math.min(top, rect.top)
      right = Math.max(right, rect.right)
      bottom = Math.max(bottom, rect.bottom)
    }

    const padding = 28
    const x = Math.max(0, Math.floor(left - padding))
    const y = Math.max(0, Math.floor(top - padding))
    const width = Math.min(window.innerWidth - x, Math.ceil(right - left + padding * 2))
    const height = Math.min(window.innerHeight - y, Math.ceil(bottom - top + padding * 2))

    if (width < 50 || height < 30) {
      return undefined
    }

    return { x, y, width, height }
  })
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function saveCaptchaFromPage(page, detection) {
  await fsp.mkdir(CAPTCHA_DIR, { recursive: true })

  const switched = await clickEnglishSwitch(page).catch(error => ({
    clicked: false,
    error: error.message
  }))

  if (switched.clicked) {
    console.log(`[captcha] clicked English switch: ${switched.text}`)
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined)
    await page.waitForTimeout(1000)
  }

  let latestDetection = await detectCaptcha(page)

  if (!latestDetection.englishLike) {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      await wait(1000)
      await clickEnglishSwitch(page).catch(() => undefined)
      latestDetection = await detectCaptcha(page)

      if (latestDetection.englishLike) {
        break
      }
    }
  }

  if (!latestDetection.englishLike) {
    const diagnosticPath = path.join(
      CAPTCHA_DIR,
      `kira-ru-hh-captcha-diagnostic-non-english-${safeTimestamp()}.png`
    )
    await page.screenshot({ path: diagnosticPath, fullPage: false }).catch(() => undefined)

    throw new Error(
      `Captcha was detected but English prompt was not verified. ` +
        `Diagnostic screenshot: ${diagnosticPath}. ` +
        `Initial: ${JSON.stringify(detection)} Latest: ${JSON.stringify(latestDetection)}`
    )
  }

  const clip = await captchaClip(page)
  const captchaPath = path.join(
    CAPTCHA_DIR,
    `kira-ru-hh-captcha-${safeTimestamp()}.png`
  )

  if (clip) {
    await page.screenshot({ path: captchaPath, clip })
  } else {
    await page.screenshot({ path: captchaPath, fullPage: false })
  }

  const stat = await fsp.stat(captchaPath)
  if (!stat.size) {
    throw new Error(`Captcha screenshot is empty: ${captchaPath}`)
  }

  return {
    captchaPath,
    clip,
    detection: latestDetection,
    size: stat.size
  }
}

async function captureCaptchaFromPort(port, shouldStop) {
  const { loadPlaywright } = require('../src/platform/browser/playwright.ts')
  const { chromium } = loadPlaywright()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: 60000
  })
  let disconnected = false

  browser.on('disconnected', () => {
    disconnected = true
  })

  console.log(`[monitor] connected to Dolphin CDP on port ${port}`)

  try {
    const startedAt = Date.now()

    while (!disconnected && Date.now() - startedAt < 15 * 60 * 1000) {
      const contexts = browser.contexts()
      const pages = contexts.flatMap(context => context.pages())

      for (const page of pages) {
        if (page.isClosed()) {
          continue
        }

        const detection = await detectCaptcha(page).catch(() => undefined)
        if (!detection?.isCaptcha) {
          continue
        }

        console.log(`[captcha] detected on ${detection.url} (${detection.title})`)
        return await saveCaptchaFromPage(page, detection)
      }

      if (shouldStop()) {
        break
      }

      await wait(500)
    }
  } finally {
    if (typeof browser.disconnect === 'function') {
      await browser.disconnect().catch(() => undefined)
    } else if (typeof browser.close === 'function') {
      await browser.close().catch(() => undefined)
    }
  }

  return undefined
}

async function monitorRun(getOrchestratorDone) {
  let runLogPath
  let port
  let capturePromise
  let finalStatus
  const afterExitGraceUntil = () => Date.now() + 5000
  let graceUntil

  while (true) {
    const snapshot = await getRunLogSnapshot()

    if (snapshot) {
      if (!runLogPath || runLogPath !== snapshot.logPath) {
        runLogPath = snapshot.logPath
        console.log(`[monitor] run log: ${runLogPath}`)
      }

      finalStatus = getFinalStatus(snapshot.records) || finalStatus

      if (!port) {
        port = getDolphinPort(snapshot.records)
        if (port) {
          console.log(`[monitor] Dolphin port found: ${port}`)
          capturePromise = captureCaptchaFromPort(port, () => Boolean(finalStatus || getOrchestratorDone()))
            .catch(error => ({ error }))
        }
      }
    }

    if (capturePromise) {
      const captured = await Promise.race([
        capturePromise,
        wait(1).then(() => undefined)
      ])

      if (captured) {
        if (captured.error) {
          throw captured.error
        }

        return {
          captured,
          finalStatus,
          runLogPath
        }
      }
    }

    if (getOrchestratorDone() || finalStatus) {
      graceUntil = graceUntil || afterExitGraceUntil()
      if (Date.now() >= graceUntil) {
        break
      }
    }

    await wait(1000)
  }

  if (capturePromise) {
    const captured = await capturePromise
    if (captured?.error) {
      throw captured.error
    }

    return {
      captured,
      finalStatus,
      runLogPath
    }
  }

  return {
    captured: undefined,
    finalStatus,
    runLogPath
  }
}

function spawnOrchestrator(env) {
  const child = childProcess.spawn(
    process.execPath,
    ['src/features/hh-responses/cli/orchestrator.ts'],
    {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  child.stdout.on('data', chunk => process.stdout.write(chunk))
  child.stderr.on('data', chunk => process.stderr.write(chunk))

  return child
}

function waitForChild(child) {
  return new Promise(resolve => {
    child.on('exit', (code, signal) => resolve({ code, signal }))
    child.on('error', error => resolve({ code: 1, signal: undefined, error }))
  })
}

async function main() {
  const env = makeRunEnv()

  runReadiness(env)

  const active = getActiveOrchestrators()
  if (active.length) {
    throw new Error(
      `Unexpected active HH orchestrator process(es): ${JSON.stringify(active, null, 2)}`
    )
  }
  console.log('[preflight] no active HH orchestrator process found')

  await runDolphinHealthCheck()

  let orchestratorDone = false
  const child = spawnOrchestrator(env)
  const childPromise = waitForChild(child).then(result => {
    orchestratorDone = true
    return result
  })
  const monitorPromise = monitorRun(() => orchestratorDone)

  const [childResult, monitorResult] = await Promise.all([
    childPromise,
    monitorPromise
  ])

  console.log(`[orchestrator] exited with code ${childResult.code}${childResult.signal ? ` signal ${childResult.signal}` : ''}`)

  if (childResult.error) {
    throw childResult.error
  }

  if (monitorResult.runLogPath) {
    console.log(`[result] run log: ${monitorResult.runLogPath}`)
  }

  if (monitorResult.captured) {
    console.log(`[result] captcha saved: ${monitorResult.captured.captchaPath}`)
    console.log(`[result] captcha bytes: ${monitorResult.captured.size}`)
  } else {
    console.log('[result] no captcha image captured')
  }

  if (monitorResult.finalStatus) {
    const status = monitorResult.finalStatus
    console.log(
      `[result] final status: error=${status.error || 'none'} ` +
        `stop=${status.autoResponderStopReason || 'none'} ` +
        `profileStopped=${Boolean(status.profileStopped)} ` +
        `tagRemoved=${Boolean(status.profileTagRemoved)} ` +
        `statusRestored=${Boolean(status.profileStatusRestored)}`
    )
  }

  if (childResult.code !== 0) {
    process.exitCode = childResult.code || 1
  }
}

main().catch(error => {
  console.error(`[fatal] ${error && error.stack ? error.stack : error}`)
  process.exitCode = 1
})

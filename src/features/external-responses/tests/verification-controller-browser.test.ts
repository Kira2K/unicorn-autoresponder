import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchFixtureBrowser } from './browser-driver.ts'
import { createVerificationController } from '../applications/verification-controller.ts'
import { createCanvas } from '@napi-rs/canvas'

test('retained-page verification controller crops, checks pixels, and never submits', async () => {
  const browser = await launchFixtureBrowser(), directory = await mkdtemp(join(tmpdir(), 'verification-controller-'))
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: route.request().url().includes('hcaptcha-enclave')
      ? '<body style="margin:0;background:#ccc"><div>Drag the letter to the place where it fits</div><button id="piece">A</button><script>window.clicks=0;document.body.onclick=()=>window.clicks++</script></body>'
      : '<body><button id="submit">Submit application</button></body>' }))
    await page.goto('https://fixture.test/apply')
    const src = 'https://newassets.hcaptcha.com/captcha/v1/hcaptcha-enclave.html'
    await page.setContent(`<button id="submit">Submit application</button><iframe src="${src}" title="Widget containing checkbox for hCaptcha security challenge" style="display:block;width:420px;height:300px;border:0"></iframe>`)
    await page.locator('iframe').contentFrame().locator('body').waitFor()
    await page.locator('iframe').contentFrame().locator('body').evaluate(el => el.addEventListener('click', () => { (el as HTMLElement).dataset.clicked = 'yes' }))
    await page.locator('iframe').contentFrame().locator('body').evaluate(el => { el.addEventListener('mousedown', () => { (el as HTMLElement).dataset.down = 'yes' }); el.addEventListener('mouseup', () => { (el as HTMLElement).dataset.up = 'yes' }) })
    await page.locator('#submit').evaluate(el => el.addEventListener('click', () => { (el as HTMLButtonElement).dataset.clicked = 'yes' }))
    let time = Date.now()
    const controller = createVerificationController(page, directory, () => time)
    assert.equal((await controller.inspect()).activePuzzle, true)
    const first = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    assert.match(first.path, /\.png$/)
    await assert.rejects(controller.act(first.id, { type: 'click', at: { x: 300, y: 10 } }), /out_of_bounds/)
    await assert.rejects(controller.act(first.id, { type: 'click', at: { x: 30, y: 30 } }), /missing_or_used/)
    const stale = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    await page.locator('iframe').contentFrame().locator('body').evaluate(el => { el.style.background = 'red' })
    await assert.rejects(controller.act(stale.id, { type: 'click', at: { x: 30, y: 30 } }), /snapshot_stale/)
    const expired = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    time += 61_000
    await assert.rejects(controller.act(expired.id, { type: 'click', at: { x: 30, y: 30 } }), /snapshot_expired/)
    time = Date.now()
    const valid = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    await controller.act(valid.id, { type: 'click', at: { x: 30, y: 30 } })
    assert.equal(await page.locator('iframe').contentFrame().locator('body').getAttribute('data-clicked'), 'yes')
    assert.equal(await page.locator('#submit').evaluate(el => (el as HTMLButtonElement).dataset.clicked), undefined)
    const drag = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    await controller.act(drag.id, { type: 'drag', from: { x: 30, y: 50 }, to: { x: 80, y: 80 } })
    assert.equal(await page.locator('iframe').contentFrame().locator('body').getAttribute('data-down'), 'yes')
    assert.equal(await page.locator('iframe').contentFrame().locator('body').getAttribute('data-up'), 'yes')
    assert.equal(await page.locator('#submit').getAttribute('data-clicked'), null)
    let extracted = 0, paid = 0
    const auto = createVerificationController(page, directory, () => time, { extract: async () => { extracted++; return undefined }, solver: { solve: async () => { paid++; return { coordinates: [] } } } })
    const beforePaid = await auto.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    await page.locator('iframe').contentFrame().locator('body').evaluate(el => { el.style.background = 'blue' })
    await assert.rejects(auto.solve(beforePaid.id), /snapshot_stale/)
    assert.equal(extracted, 0); assert.equal(paid, 0)
    const short = await auto.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    time += 11_000
    await assert.rejects(auto.solve(short.id), /insufficient_lifetime/)
    assert.equal(extracted, 0); assert.equal(paid, 0)
    time = Date.now()
    const scaled = createCanvas(100, 100).toBuffer('image/png')
    const scaleController = createVerificationController(page, directory, () => time, { extract: async () => ({ source: 'provider_dom', background: scaled, images: [{ bytes: scaled, from: { x: 10, y: 10 } }], instruction: 'Drag the letter' }), solver: { solve: async () => { paid++; return { coordinates: [{ x: 20, y: 20 }] } } } })
    const scaleSnapshot = await scaleController.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    await assert.rejects(scaleController.solve(scaleSnapshot.id), /asset_scale_unsupported/)
    assert.equal(paid, 0)
    const replaced = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    await page.locator('iframe').evaluate(el => el.replaceWith(el.cloneNode(true)))
    await page.locator('iframe').contentFrame().locator('body').waitFor()
    await assert.rejects(controller.act(replaced.id, { type: 'click', at: { x: 30, y: 30 } }), /frame_replaced/)
    const navigated = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 })
    await page.goto('https://fixture.test/changed')
    await assert.rejects(controller.act(navigated.id, { type: 'click', at: { x: 30, y: 30 } }), /page_navigated/)
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }) }
})

test('opaque hCaptcha frame requires reviewed visual snapshot and fresh bounds before one action', async () => {
  const browser = await launchFixtureBrowser(), directory = await mkdtemp(join(tmpdir(), 'verification-opaque-'))
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: route.request().url().includes('hcaptcha-enclave') ? '<body style="margin:0;background:#008c92"><canvas width="300" height="180"></canvas></body>' : '<body></body>' }))
    await page.goto('https://fixture.test/apply')
    await page.setContent('<button id="submit">Submit application</button><iframe src="https://newassets.hcaptcha.com/hcaptcha-enclave.html" style="display:block;width:420px;height:300px;border:0"></iframe>')
    await page.locator('iframe').contentFrame().locator('body').waitFor()
    const controller = createVerificationController(page, directory)
    const observed = await controller.inspect()
    assert.equal(observed.activePuzzle, false)
    assert.equal(observed.frames.length, 1)
    const visual = observed.frames[0].visualObservation
    assert.ok(visual?.path)
    assert.ok((await readFile(visual.path)).length > 0)
    assert.match(visual.pixelHash, /^[a-f0-9]{64}$/)
    await assert.rejects(controller.capture(0, { x: 0, y: 0, width: 200, height: 120 }), /crop_invalid/)
    const unconfirmed = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 }, 'visual')
    await assert.rejects(controller.act(unconfirmed.id, { type: 'click', at: { x: 30, y: 30 } }), /visual_confirmation_required/)
    const stale = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 }, 'visual')
    assert.equal((await controller.confirmVisual(stale.id, 'assistant')).reviewSource, 'assistant_reviewed_image')
    await page.locator('iframe').contentFrame().locator('body').evaluate(el => { el.style.background = '#ff0000' })
    await assert.rejects(controller.act(stale.id, { type: 'drag', from: { x: 30, y: 30 }, to: { x: 80, y: 80 } }), /snapshot_stale/)
    const moved = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 }, 'visual')
    await controller.confirmVisual(moved.id, 'assistant')
    await page.locator('iframe').evaluate(el => { (el as HTMLElement).style.marginLeft = '5px' })
    await assert.rejects(controller.act(moved.id, { type: 'click', at: { x: 30, y: 30 } }), /frame_replaced/)
    await page.locator('iframe').contentFrame().locator('body').evaluate(el => el.addEventListener('click', () => { (el as HTMLElement).dataset.clicked = 'yes' }))
    const reviewed = await controller.capture(0, { x: 0, y: 0, width: 200, height: 120 }, 'visual')
    await controller.confirmVisual(reviewed.id, 'assistant')
    await controller.act(reviewed.id, { type: 'click', at: { x: 30, y: 30 } })
    assert.equal(await page.locator('iframe').contentFrame().locator('body').getAttribute('data-clicked'), 'yes')
    assert.equal(await page.locator('#submit').getAttribute('data-clicked'), null)
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }) }
})

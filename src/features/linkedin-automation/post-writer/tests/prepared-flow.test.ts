import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'

const text = '  Готовый текст автора 🦄\n\nСохраняем абзацы и не переписываем содержание.  '
const plan = () => ({ ...defaults(203), scheduled: true, contentMode: 'prepared' as const,
  preparedPosts: [{ date: '2026-09-07', text }] })

test('pasted text publishes with one meme, no CV or text generation, and no duplicate after restart', async () => {
  const f = fixture(); let plans = 0, images = 0
  f.deps.source.context = async () => { throw Error('must not read CV') }
  f.deps.generator.topics = f.deps.generator.draft = async () => { throw Error('must not generate text') }
  const render = f.deps.memes!.render, makePlan = f.deps.memes!.plan
  f.deps.memes!.render = async (...args) => { images++; return render(...args) }
  f.deps.memes!.plan = async (...args) => { plans++; assert.equal(args[0].post, text); return makePlan(...args) }
  f.restart()
  await f.service.update(203, plan())
  await f.step(); await f.step(6000)
  const run = await f.run()
  assert.equal(run.status, 'published'); assert.equal(run.draft!.text, text)
  assert.ok(run.postImageId); assert.equal(plans, 1); assert.equal(images, 1)
  f.restart(); await f.step(6000)
  assert.equal(f.counts.publish, 1); assert.equal(images, 1)
  assert.equal((await f.service.get(203)).settings.preparedPosts![0].text, text)
})

test('started text cannot change; settings saves and blank next day do not create new posts', async () => {
  const f = fixture()
  await Promise.all([f.service.update(203, plan()), f.service.update(203, plan())])
  await f.step(); await f.step(6000)
  await assert.rejects(f.service.update(203, { ...plan(), preparedPosts: [{ date: '2026-09-07', text: 'Changed' }] }),
    /post_prepared_day_started/)
  await f.service.update(203, plan())
  f.setNow(Date.parse('2026-09-08T10:00:00+03:00')); await f.step()
  assert.equal(f.counts.publish, 1)
  assert.equal((await f.run()).preparedPost!.text, text)
})

test('forbidden topic blocks prepared content without repairing or sending it', async () => {
  const f = fixture()
  await f.service.update(203, { ...plan(), forbiddenTopics: ['готовый текст'] })
  await f.step()
  const run = await f.run()
  assert.equal(run.status, 'blocked'); assert.equal(run.errorCode, 'post_topic_forbidden')
  assert.equal(run.draft!.text, text); assert.equal(f.counts.publish, 0); assert.equal(run.meme, undefined)
})

test('one prepared run for each chosen day; second day uses its own stored text', async () => {
  const f = fixture(), makePlan = f.deps.memes!.plan
  f.deps.memes!.plan = async input => {
    const value = await makePlan(input) as any
    value.concept.scene = input.post
    return value
  }
  f.restart()
  const nextText = 'Другой готовый текст для следующего дня. Не заменять предыдущим.'
  await f.service.update(203, { ...plan(), preparedPosts: [...plan().preparedPosts,
    { date: '2026-09-09', text: nextText }] })
  await f.step(); await f.step(6000)
  f.setNow(Date.parse('2026-09-09T10:00:00+03:00')); await f.step(); await f.step(6000)
  assert.equal((await f.run()).status, 'published'); assert.equal((await f.run()).draft!.text, nextText)
  assert.equal(f.counts.publish, 2)
})

test('a full week publishes all seven days once, including weekends, across restarts', async () => {
  const f = fixture(), makePlan = f.deps.memes!.plan, render = f.deps.memes!.render
  let images = 0
  f.deps.source.context = async () => { throw Error('must not read CV') }
  f.deps.memes!.plan = async input => {
    const value = await makePlan(input) as any
    value.concept.scene = input.post
    return value
  }
  f.deps.memes!.render = async (...args) => { images++; return render(...args) }
  f.restart()
  const posts = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${String(7 + index).padStart(2, '0')}`, text: `  Пост на день ${index + 1}.\n\nСвой мем 🦄  `
  }))
  await f.service.update(203, { ...plan(), preparedPosts: posts })
  for (const post of posts) {
    f.setNow(Date.parse(`${post.date}T10:00:00+03:00`))
    f.restart(); await f.step(); await f.step(6000)
    assert.equal((await f.run()).status, 'published')
    assert.equal((await f.run()).draft!.text, post.text)
  }
  f.setNow(Date.parse('2026-09-14T10:00:00+03:00')); f.restart(); await f.step()
  assert.equal((await f.service.get(203)).runs.length, 7)
  assert.equal(f.counts.publish, 7); assert.equal(images, 7)
})

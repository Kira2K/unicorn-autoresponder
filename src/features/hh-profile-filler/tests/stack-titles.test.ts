import assert from 'node:assert/strict'
import { STACK_TITLE_MAP, titlesForStack } from '../stack-titles.ts'

export function runStackTitleTests() {
  assert.deepEqual(titlesForStack('FullStack', 'En'), [
    'Senior Fullstack Developer', 'Senior Backend Developer', 'Senior Frontend Developer'
  ])
  assert.deepEqual(titlesForStack('Golang', 'En'), [
    'Senior Go Developer', 'Senior Golang Developer', 'Senior Backend Developer'
  ])
  assert.equal(titlesForStack('Go', 'En').includes('S'), false)
  assert.equal(STACK_TITLE_MAP.java.Ru.length, 2)
  assert.throws(() => titlesForStack('Data Science', 'Ru'), /No HH resume title mapping/)
}

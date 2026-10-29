const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeSuccessfulVacancies, preserveSuccessfulVacancyHistory } = require('./history.ts');

test('imports only successful vacancies, deduplicates without deleting existing history', () => {
  assert.deepEqual(mergeSuccessfulVacancies(['v_1'], [
    'v_2:1700000000000:1', 'v_2:1700000000001:2', 'unknown:2:3', 'v_3:4:1'
  ]), ['v_1', 'v_2', 'v_3']);
});

test('reads only HH tabs; unavailable tab does not erase surviving history', async () => {
  const kept = [];
  const pages = [
    {url: () => 'https://web.telegram.org/a/', evaluate: () => assert.fail('unrelated tab')},
    {url: () => 'https://hh.ru/vacancy/1', evaluate: async () => { throw Error('navigating'); }},
    {url: () => 'https://hh.ru/search/vacancy', evaluate: async (fn, ids) => {
      if (Array.isArray(ids)) { kept.push(...ids); return; }
      return {history: ['v_1'], successful: ['v_2:1:1']};
    }}
  ];
  assert.equal(await preserveSuccessfulVacancyHistory({pages: () => pages}), 2);
  assert.deepEqual(kept, ['v_1', 'v_2']);
});

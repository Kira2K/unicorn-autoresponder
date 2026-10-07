import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fillProfileLanguages } from '../hh-languages.ts'

export async function runHHLanguageTests() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    let rows = [{ name: 'Грузинский', level: 'Родной' }, { name: 'Английский', level: 'B1' }]
    let writes = 0
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/fixture-save') {
        const { index, name, level } = route.request().postDataJSON()
        if (index < 0) rows.push({ name, level })
        else rows[index] = { name, level }
        writes++
        return route.fulfill({ json: {} })
      }
      if (url.pathname !== '/profile/block/languages') return route.abort()
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <meta charset="utf-8">
        <div id="cards"></div><button data-qa="profile-language-add">Добавить</button>
        <button role="combobox" aria-label="Выбор языка сайта" onclick="throw Error('wrong control')">Русский</button>
        <script>
        const rows = ${JSON.stringify(rows)};
        rows.forEach((row, index) => {
          const card = document.createElement('div');
          card.dataset.qa = 'profile-language-bottom-sheet-content-' + index;
          card.innerHTML = '<button>' + row.name + ' ' + row.level + '</button>';
          card.querySelector('button').onclick = () => edit(index);
          document.querySelector('#cards').append(card);
        });
        document.querySelector('[data-qa="profile-language-add"]').onclick = () => edit(-1);
        function edit(index) {
          let name = rows[index]?.name || '', level = rows[index]?.level || '';
          const modal = document.createElement('div'); modal.setAttribute('role', 'dialog');
          modal.innerHTML = '<div data-qa="profile-language-add-form-language"><div role="combobox" data-qa="magritte-select-activator" aria-label="Язык">Язык</div></div>' +
            '<div data-qa="profile-language-add-form-degree"><div role="combobox" data-qa="magritte-select-activator" aria-label="Уровень владения">Уровень владения</div></div>' +
            '<button data-qa="profile-modal-button-save">Сохранить</button>';
          document.body.append(modal);
          function options(values, choose) {
            document.querySelectorAll('[role="option"]').forEach(el => el.remove());
            values.forEach(value => {
              const option = document.createElement('button'); option.setAttribute('role', 'option');
              option.textContent = value; option.onclick = () => { choose(value); document.querySelectorAll('[role="option"]').forEach(el => el.remove()); };
              document.body.append(option);
            });
          }
          modal.querySelector('[aria-label="Язык"]').onclick = () => options(['Русский', 'Английский'], value => name = value);
          modal.querySelector('[aria-label="Уровень владения"]').onclick = () => options(['B1 — Средний', 'C1 — Продвинутый'], value => level = value);
          modal.querySelector('button').onclick = async () => {
            await fetch('/fixture-save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({index, name, level}) }); modal.remove();
          };
        }
        </script>` })
    })
    const requested = [{ name: 'Russian', level: 'Native' }, { name: 'English', level: 'C1' }]
    await fillProfileLanguages(page, requested)
    assert.equal(writes, 2)
    assert.equal(rows.length, 2, 'edit matching language and native row instead of duplicating')
    assert.deepEqual(rows, [{ name: 'Русский', level: 'Родной' }, { name: 'Английский', level: 'C1 — Продвинутый' }])
    await fillProfileLanguages(page, requested)
    assert.equal(writes, 2, 'matching values must be read and skipped')
    rows = []
    await fillProfileLanguages(page, [{ name: 'English', level: 'C1' }])
    assert.equal(rows.length, 1)
    await fillProfileLanguages(page, [{ name: 'English', level: 'C1' }])
    assert.equal(rows.length, 1)
    rows.push({ ...rows[0] })
    await assert.rejects(() => fillProfileLanguages(page, [{ name: 'English', level: 'C1' }]),
      { code: 'profile_hh_language_ambiguous' })
  } finally { await browser.close() }
}

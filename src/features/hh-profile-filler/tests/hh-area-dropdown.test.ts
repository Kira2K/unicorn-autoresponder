import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { setArea } from '../hh-resume-ui.ts'

export async function runAreaDropdownTests() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    for (const exact of [true, false]) {
      await page.setContent(`
        <input data-qa="profile-common-edit-area" role="combobox"
          aria-controls=":city:" aria-expanded="false" value="Саратов">
        <div role="listbox" id="unrelated"><div role="option">Москва</div></div>
        <div role="listbox" id=":city:" hidden>
          <div role="option">${exact ? 'Москва' : 'Троицк (Москва)'}</div>
        </div>
        <script>
          const input = document.querySelector('input');
          const list = document.getElementById(':city:');
          input.addEventListener('input', () => {
            list.hidden = false; input.setAttribute('aria-expanded', 'true');
          });
          list.querySelector('[role="option"]').addEventListener('click', () => {
            window.selectedCity = list.textContent.trim();
            input.value = window.selectedCity;
            input.setAttribute('aria-expanded', 'false'); list.hidden = true;
          });
        </script>`)
      if (exact) {
        await setArea(page, 'Москва, Россия')
        assert.equal(await page.evaluate(() => (window as any).selectedCity), 'Москва')
        assert.equal(await page.locator('input').inputValue(), 'Москва')
        await setArea(page, 'Москва, Россия')
        assert.equal(await page.locator('input').getAttribute('aria-expanded'), 'false')
      } else {
        await assert.rejects(setArea(page, 'Москва'),
          (e: any) => e.code === 'profile_hh_area_not_accepted')
      }
    }
  } finally { await browser.close() }
}

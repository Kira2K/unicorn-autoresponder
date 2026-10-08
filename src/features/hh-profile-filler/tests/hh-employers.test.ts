import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { configurePrivacyAndStopList } from '../hh-resume-ui.ts'
import type { PreparedProfile } from '../types.ts'

export async function runHHEmployerTests() {
  const browser = await chromium.launch({ headless: true })
  let stored: string[] = ['Legacy employer']
  let ignoreWrites = false
  try {
    const page = await browser.newPage()
    await page.route('**/*', async route => {
      if (route.request().method() === 'POST') {
        if (!ignoreWrites) stored = route.request().postDataJSON()
        return route.fulfill({ json: {} })
      }
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <meta charset="utf-8">
        <button data-qa="resume-visibility-card">Видимость резюме</button>
        <label data-qa="resume-visibility-card-access-type-blacklist"><input type="radio" checked>Скрыто от выбранных работодателей</label>
        <div data-qa="cell"><span>Анонимное резюме</span><button role="switch" aria-checked="true">Анонимность</button></div>
        <label data-qa="resume-visibility-card-hidden-fields-phones"><input type="checkbox" checked>Телефоны</label>
        ${['names_and_photo', 'email', 'other_contacts', 'experience'].map(name =>
          '<label data-qa="resume-visibility-card-hidden-fields-' + name + '"><input type="checkbox"></label>').join('')}
        <button data-qa="applicant-employers-list-activator-blacklist"></button>
        <button data-qa="resume-partial-edit-save">Сохранить</button>
        <script>
          const committed = new Set(${JSON.stringify(stored)});
          const trigger = document.querySelector('[data-qa="applicant-employers-list-activator-blacklist"]');
          const refresh = () => trigger.textContent = [...committed].join(', ') || 'Выберите работодателей'; refresh();
          trigger.onclick = () => setTimeout(() => {
            const modal = document.createElement('div');
            modal.innerHTML = '<input data-qa="resume-editor-employer-list-search-input"><div id="results"></div><button data-qa="resume-modal-button-save">Добавить</button>';
            let selected;
            modal.querySelector('input').oninput = event => {
              selected = undefined; // HH drops unsaved selection when the query changes.
              const name = event.target.value;
              modal.querySelector('#results').innerHTML = '';
              if (!['Employer A', 'Employer B'].includes(name)) return;
              const row = document.createElement('label'); row.dataset.qa = 'cell';
              row.innerHTML = '<input type="checkbox">' + name;
              row.querySelector('input').checked = committed.has(name);
              row.querySelector('input').onchange = event => selected = event.target.checked ? name : undefined;
              modal.querySelector('#results').append(row);
            };
            modal.querySelector('button').onclick = () => { if (selected) committed.add(selected); modal.remove(); refresh(); };
            document.body.append(modal);
            for (const name of new Set([...committed, 'Employer A', 'Employer B'])) {
              const row = document.createElement('label'); row.dataset.qa = 'cell';
              row.innerHTML = '<input type="checkbox">' + name;
              row.querySelector('input').checked = committed.has(name);
              modal.querySelector('#results').append(row);
            }
          }, 200);
          document.querySelector('[data-qa="resume-partial-edit-save"]').onclick = () => fetch('/save', {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify([...committed])
          });
        </script>` })
    })
    const profile = { cv: { contacts: {} }, employerCandidates: [
      { name: 'Employer A', sources: ['cv'] }, { name: 'Employer B', sources: ['cv'] }, { name: 'Missing Co', sources: ['cv'] }
    ] } as PreparedProfile
    const resume = { id: 'draft', title: 'Draft', href: '', isDraft: true }
    const first = await configurePrivacyAndStopList(page, resume, profile)
    assert.deepEqual(stored, ['Legacy employer', 'Employer A', 'Employer B'])
    assert.equal(first.preservedEmployers, true, 'Saved exclusions survive even when unavailable in directory search')
    assert.deepEqual(first.employers.filter(item => item.status === 'added').map(item => item.officialName), ['Employer A', 'Employer B'])
    assert.deepEqual(first.employers.filter(item => item.status === 'skipped').map(item =>
      ({ name: item.candidate, reason: item.reason })), [{ name: 'Missing Co', reason: 'not_found' }])
    const second = await configurePrivacyAndStopList(page, resume, profile)
    assert.deepEqual(second.employers.filter(item => item.status === 'existing').map(item => item.officialName), ['Employer A', 'Employer B'])
    assert.deepEqual(second.employers.filter(item => item.status === 'added'), [])
    assert.equal(stored.length, 3)
    stored = []
    ignoreWrites = true
    await assert.rejects(() => configurePrivacyAndStopList(page, resume, profile),
      { code: 'profile_hh_employer_selection_not_persisted' })
  } finally { await browser.close() }
}

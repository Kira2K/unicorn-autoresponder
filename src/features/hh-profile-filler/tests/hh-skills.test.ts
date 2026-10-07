import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { ensureResumeSkills, verifyResumeSkills } from '../hh-skills.ts'

export async function runHHSkillsTests() {
  const browser = await chromium.launch({ headless: true }).catch(() =>
    chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage()
    const id = 'a'.repeat(34)
    const resume = { id, title: 'Known title', href: `https://hh.ru/resume/${id}`, isDraft: false }
    const expected = Array.from({ length: 30 }, (_, index) => `Skill ${index}`)
    let saved = [{ name: expected[0], level: null as string | null }, { name: 'Unrelated', level: null }]
    let nameWrites = 0
    let levelWrites = 0
    let discardLevel = false
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/test-save-names') {
        nameWrites += 1
        saved = route.request().postDataJSON().map((name: string) => ({ name,
          level: saved.find(item => item.name === name)?.level ?? null }))
        return route.fulfill({ body: 'ok' })
      }
      if (url.pathname === '/test-save-levels') {
        levelWrites += 1
        saved = route.request().postDataJSON()
        if (discardLevel) saved[29].level = null
        return route.fulfill({ body: 'ok' })
      }
      if (url.pathname.endsWith('/keySkills')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <div data-qa="resume-editor-skills-input"><div id="selected"></div>
          <input data-qa="chips-trigger-input" oninput="option.textContent=this.value;option.hidden=!this.value">
        </div><div id="option" hidden data-qa="suggest-item-user-input" onclick="add()"></div>
        <div data-qa="resume-editor-skills-recommended-Unselected">Unselected recommendation</div>
        <button onclick="save()">Сохранить</button>
        <script>
          let names=${JSON.stringify(saved.map(item => item.name))};
          function render(){selected.replaceChildren(...names.map((name,index)=>{
            const chip=document.createElement('div');chip.dataset.qa='chips-trigger-chip-'+name;
            chip.append(document.createTextNode(name));const remove=document.createElement('button');
            remove.onclick=()=>{names.splice(index,1);render()};chip.append(remove);return chip;
          }))}
          function add(){names.push(option.textContent);option.hidden=true;
            document.querySelector('input').value='';render()}
          async function save(){await fetch('/test-save-names',{method:'POST',body:JSON.stringify(names)});
            location.href='/resume/edit/${id}/skillsLevels'}
          render();
        </script>` })
      if (url.pathname.endsWith('/skillsLevels')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        ${saved.map((item, index) => `<div data-qa="skill"><div data-qa="skillName">${item.name}</div>
          <label><input type="radio" name="level${index}" value="basic"><div data-qa="skill-level-1">Базовый</div></label>
          <label><input type="radio" name="level${index}" value="advanced" ${item.level === 'advanced' ? 'checked' : ''}>
          <div data-qa="skill-level-3">Продвинутый</div></label></div>`).join('')}
        <style>input[type=radio]{position:absolute;opacity:0;width:1px;height:1px}</style>
        <button onclick="save()">Сохранить</button><script>
          async function save(){const rows=[...document.querySelectorAll('[data-qa=skill]')].map(row=>({
            name:row.querySelector('[data-qa=skillName]').textContent,
            level:row.querySelector('input:checked')?.value??null}));
            await fetch('/test-save-levels',{method:'POST',body:JSON.stringify(rows)});
            location.href='/resume/${id}'}
        </script>` })
      return route.fulfill({ body: 'Saved resume' })
    })
    const result = await ensureResumeSkills(page, resume, expected)
    assert.equal(result.length, 30)
    assert.ok(result.every(item => item.level === 'advanced'))
    assert.equal(nameWrites, 1)
    assert.equal(levelWrites, 1)
    await ensureResumeSkills(page, resume, expected)
    assert.equal(nameWrites, 1, 'A complete set must not be rewritten')
    assert.equal(levelWrites, 1, 'Already advanced radios must not be clicked/saved again')
    saved[29].level = null
    discardLevel = true
    await assert.rejects(ensureResumeSkills(page, resume, expected), { code: 'profile_hh_skills_incomplete' })
    saved = saved.slice(0, 29)
    await assert.rejects(verifyResumeSkills(page, resume, expected), { code: 'profile_hh_skills_incomplete' })
    saved = []
    await assert.rejects(verifyResumeSkills(page, resume, expected), { code: 'profile_hh_skills_incomplete' })
  } finally { await browser.close() }
}

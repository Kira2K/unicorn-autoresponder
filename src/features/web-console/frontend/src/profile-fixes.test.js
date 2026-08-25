const assert = require('node:assert/strict')

async function run() {
  const { applyProfileFixes, readProfilePath } = await import('./profile-fixes.js')
  const source = { profile: { experience: [{ data: {
    job_title: 'Old title', skills: ['First', 'Second', 'Third']
  } }], open_to_work: { job_titles: [{ name: 'Old generated role' }] } } }
  const fixed = applyProfileFixes(source, [
    { path: 'profile.experience[0].data.job_title', value: 'Backend Engineer' },
    { path: 'profile.experience[0].data.skills[0]', remove: true },
    { path: 'profile.experience[0].data.skills[2]', remove: true },
    { path: 'profile.open_to_work.job_titles[0].name', value: 'Backend Engineer' }
  ])
  assert.equal(readProfilePath(fixed, 'profile.experience[0].data.job_title'), 'Backend Engineer')
  assert.deepEqual(fixed.profile.experience[0].data.skills, ['Second'])
  assert.equal(fixed.profile.open_to_work.job_titles[0].name, 'Backend Engineer')
  assert.equal(source.profile.experience[0].data.job_title, 'Old title')
}

run().then(() => console.log('profile fixes tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})

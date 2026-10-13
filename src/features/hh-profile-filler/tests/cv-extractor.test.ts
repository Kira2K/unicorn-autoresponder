import assert from 'node:assert/strict'
import { createCvExtractor } from '../cv-extractor.ts'

export async function runCvExtractorTests() {
  const uploads: string[] = []
  const removed: string[] = []
  let request: any
  const extractor = createCvExtractor({ client: {
    async upload(_bytes, fileName) { uploads.push(fileName); return `file-${uploads.length}` },
    async respond(input) {
      request = input
      return {
        full_name: 'Test User', first_name: 'Test', last_name: 'User', middle_name: null,
        birth_date: null, location: null, position: 'Engineer',
        contacts: { email: 'test@example.com', phone: null, telegram: null,
          linkedin: null, other: [] },
        summary: 'Summary', skill_groups: [], skills: ['TypeScript'],
        experience: [{ company: 'Employer', title: 'Engineer', start_date: null,
          end_date: 'Present', current: true, location: null, description: 'Built systems.',
          technologies: ['TypeScript'], named_organizations: ['Vendor'] }],
        education: [], languages: [{ name: 'English', level: 'B2' }],
        named_organizations: ['Partner']
      }
    },
    async remove(fileId) { removed.push(fileId) }
  } })
  const profile = await extractor.extract([{ bytes: Buffer.from('cv'), fileName: 'cv.pdf',
    mimeType: 'application/pdf', revision: '1', source: 'cv' }], 'En')
  assert.deepEqual(uploads, ['cv.pdf'])
  assert.deepEqual(removed, ['file-1'])
  assert.equal(request[0].content.filter((item: any) => item.type === 'input_file').length, 1)
  assert.match(request[0].content.at(-1).text, /final CV only/i)
  assert.deepEqual(profile.namedOrganizations, ['Partner'])
  assert.equal(profile.experience[0].current, true)
  assert.equal(profile.experience[0].endDate, undefined)
}

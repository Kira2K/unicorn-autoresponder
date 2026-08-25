import assert from 'node:assert/strict'
import { createProfileGenerator } from '../generation/openai-generator.ts'
import { emptyFacts, generatedDocument } from './generation-fixture.ts'

async function run() {
  const responseBodies: any[] = []; const paths: string[] = []
  const generatedOutput: any = generatedDocument()
  generatedOutput.profile.about_blocks = ['Introduction', 'Achievements', 'Approach', 'Stack']
  delete generatedOutput.profile.about
  const outputs = [emptyFacts, generatedOutput, { choices: [
    { index: 0, candidate_id: 'role-1', confident: true }
  ] }, { profile: { about_blocks: ['One', 'Two', 'Three', 'Four'] } }]
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname; paths.push(`${init?.method}:${path}`)
    if (path.endsWith('/files') && init?.method === 'POST') {
      assert(init.body instanceof FormData)
      return new Response(JSON.stringify({ id: 'cv-file' }), { status: 200 })
    }
    if (path.endsWith('/responses')) {
      responseBodies.push(JSON.parse(String(init?.body)))
      const output = outputs[responseBodies.length - 1]
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text',
        text: JSON.stringify(output) }] }] }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  const generator = createProfileGenerator({ apiKey: 'not-logged', model: 'mock-model',
    timeoutMs: 1000, maxOutputTokens: 20_000, fetchImpl,
    baseUrl: 'https://openai.test/v1' })
  const facts = await generator.extractFacts({ bytes: Buffer.from('private CV'),
    fileName: 'cv.pdf', mimeType: 'application/pdf', revision: '1' })
  const profile = await generator.generateProfile(facts, 'Poland')
  const choices = await generator.chooseJobTitles([{ index: 0, requested: 'Go developer',
    candidates: [{ id: 'role-1', name: 'Golang Developer' }] }])
  const repaired = await generator.repairProfile(profile, facts, 'Poland', [{ level: 'fatal',
    path: 'profile.about', message: 'About must contain 4-5 blocks.' }])
  assert.equal((profile as any).profile.headline, generatedDocument().profile.headline)
  assert.equal((profile as any).profile.about,
    'Introduction\n\nAchievements\n\nApproach\n\nStack')
  assert.deepEqual(choices, [{ index: 0, candidateId: 'role-1', confident: true }])
  assert.deepEqual(responseBodies.map(body => body.text.format.name),
    ['linkedin_cv_facts', 'linkedin_profile', 'linkedin_job_title_choices',
      'linkedin_profile_repair'])
  assert(responseBodies.every(body => body.store === false && body.tools.length === 0 &&
    body.text.format.strict === true))
  assert.equal(responseBodies[0].input[0].content[0].file_id, 'cv-file')
  assert.match(responseBodies[2].input[0].content[0].text, /role-1/)
  assert.equal(responseBodies[2].max_output_tokens, 1_200)
  assert(responseBodies[1].text.format.schema.properties.profile.properties.about_blocks)
  assert(responseBodies[3].text.format.schema.properties.profile.properties.about_blocks)
  assert.equal(responseBodies[3].text.format.schema.properties.profile.properties.headline, undefined)
  assert.equal(repaired.profile.about, 'One\n\nTwo\n\nThree\n\nFour')
  assert.equal(repaired.profile.headline, profile.profile.headline)
  assert(paths.includes('DELETE:/v1/files/cv-file'))

  let attempts = 0
  const retryGenerator = createProfileGenerator({ apiKey: 'safe', model: 'mock-model',
    timeoutMs: 1000, maxOutputTokens: 20_000, baseUrl: 'https://openai.test/v1',
    fetchImpl: (async () => {
      attempts += 1
      if (attempts === 1) return new Response(JSON.stringify({ status: 'incomplete' }),
        { status: 200 })
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text',
        text: JSON.stringify({ choices: [{ index: 0, candidate_id: 'role-1',
          confident: true }] }) }] }] }), { status: 200 })
    }) as typeof fetch })
  const retried = await retryGenerator.chooseJobTitles([{ index: 0, requested: 'Engineer',
    candidates: [{ id: 'role-1', name: 'Software Engineer' }] }])
  assert.equal(attempts, 2)
  assert.equal(retried[0].candidateId, 'role-1')
}

run().then(() => console.log('profile generation OpenAI tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})

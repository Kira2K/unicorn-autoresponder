import { codedError } from '../errors.ts'

export function responseText(response: any) {
  if (response?.status === 'incomplete') throw codedError('openai_response_incomplete',
    'OpenAI did not complete profile generation.')
  const content = (response?.output ?? []).flatMap((item: any) => item?.content ?? [])
  if (content.some((item: any) => item?.type === 'refusal')) {
    throw codedError('openai_response_refused', 'OpenAI refused profile generation.')
  }
  const text = content.filter((item: any) => item?.type === 'output_text')
    .map((item: any) => item?.text).join('')
  if (!text) throw codedError('openai_response_invalid', 'OpenAI returned no structured output.')
  try { return JSON.parse(text) }
  catch { throw codedError('openai_response_invalid', 'OpenAI returned invalid structured output.') }
}

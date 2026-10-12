import type { Outcome } from '../types.ts'

export function classifyOutcome(input: { text: string; url: string; responses: string[] }): Outcome {
  const text = [input.text, ...input.responses].join('\n').replace(/[\u2018\u2019]/g, "'")
  if (/RECAPTCHA_SCORE_BELOW_THRESHOLD|flagged.{0,30}spam|you are a robot|suspected.{0,20}bot|automated requests|unusual traffic/i.test(text)) return { status: 'blocked', reason: 'robot_rejected', detail: 'Employer rejected the attempt as automated or spam.' }
  if (/security code for your application|a verification code was sent to|enter.{0,25}(verification|security) code|verify your email|email verification required|HTTP 428/i.test(text)) return { status: 'blocked', reason: 'email_verification_required', detail: 'Email verification requires candidate input.' }
  if (/captchaToken.{0,40}(invalid|required|missing)|captcha.{0,40}(failed|required|invalid)|complete.{0,25}captcha|verify you are human/i.test(text)) return { status: 'blocked', reason: 'captcha_required', detail: 'Complete the verification in the preserved browser tab.' }
  if (/Missing entry for required field|validation.{0,15}error|something went wrong|"errors"\s*:\s*\[\s*\{/i.test(text) || /required field|is required/i.test(input.responses.join('\n'))) return { status: 'failed', reason: 'validation_error', detail: 'The employer returned an error; no successful submission was confirmed.' }
  const receipt = /your application (?:was |has been )?(?:successfully submitted|received)|thank you for applying|thanks for applying|we(?:'ve| have) received your application|application submitted successfully|FormSubmitSuccess/i.test(text)
    || /process completed/i.test(input.text) && /thank you for your job application/i.test(input.text)
  if (receipt || /\/thanks(?:[/?#]|$)/.test(input.url)) return { status: 'succeeded', detail: 'Employer confirmation observed.', evidence: { url: input.url, observedAt: new Date().toISOString(), confirmation: 'captured', message: receipt ? 'Explicit employer application confirmation' : 'Employer /thanks confirmation page' } }
  return { status: 'unknown', reason: 'unknown_outcome', detail: 'No explicit confirmation or definite rejection was observed. Reconcile before retrying.' }
}

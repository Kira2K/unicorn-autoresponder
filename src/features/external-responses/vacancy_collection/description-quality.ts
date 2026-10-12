/** Extraction quality, not role eligibility. Keep the original body in the audit. */
export function descriptionIssue(body: string): string | undefined {
  if (body.trim().length < 80) return 'description_too_short'
  const consent = /cookie|consent preferences|privacy preferences|tracking technologies|manage consent|файлы cookie/i.test(body)
  const duties = /responsibilit|qualifications?|requirements?|you will|your role|what you.ll do|experience (?:with|in)|обязанност|требован|вам предстоит/i.test(body)
  if (consent && !duties) return 'consent_or_cookie_body_without_job_details'
  const employerMarketing = /(?:about (?:us|the company)|fast-growing|award-winning company|work culture|join (?:us|[\w ]+).{0,80}(?:opportunit|growth)|with offices in)/i.test(body)
  if (employerMarketing && !duties) return 'company_boilerplate_without_job_details'
}

import { createCvExtractor } from '../../hh-profile-filler/cv-extractor.ts'
import type { CvExtractor,Fact } from '../types.ts'
import type { Client } from '../infrastructure/ai.ts'
export function existingCvExtractor(client: Client): CvExtractor {
  return { extract: async (bytes, fileName) => {
    const extractor = createCvExtractor({ client })
    const profile = await extractor.extract([{ bytes, fileName, mimeType: 'application/pdf', source: 'cv', fileId: 'input' } as any], 'En')
    const values: Record<string, unknown> = { fullName: profile.fullName, firstName: profile.firstName, lastName: profile.lastName, email: profile.contacts.email, phone: profile.contacts.phone, linkedin: profile.contacts.linkedin, location: profile.location, skills: profile.skills.join(', '), resume: JSON.stringify(profile) }
    return Object.fromEntries(Object.entries(values).filter(([, v]) => v).map(([k, v]) => [k, { value: String(v), source: 'cv', evidence: `${fileName}: extracted ${k}` } as Fact]))
  } }
}

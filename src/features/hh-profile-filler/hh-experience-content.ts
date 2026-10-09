import type { Page } from 'playwright'
import type { CvExperience } from './types.ts'
import type { ResumeSnapshot } from './hh-resume-ui.ts'
import { experienceContentMatches, experienceContentDifferences } from './content-policy.ts'

// Called immediately after exact-resume membership verification on the wizard.
export async function readExperienceContent(page: Page, resume: ResumeSnapshot, items: CvExperience[]): Promise<string[]> {
      if (resume.isDraft && !resume.nativeSourceId) {
        // Membership was read from this exact draft immediately before this call.
        // HH keeps selected work records in the profile until final publication.
        // Require the full source role/dates/description in each selected card;
        // then verify the employer and all remaining fields in the profile cards.
        const selected = await page.locator('[data-qa*="resume-profile-screen_experience"] ' +
          'label[data-qa="cell"]:has(input:checked)').allInnerTexts()
        for (let index = 0; index < items.length; index++) {
          const item = { ...items[index], company: '', location: undefined }
          if (selected.filter(text => experienceContentMatches(text, item)).length !== 1) {
            const differences = selected.map(text => experienceContentDifferences(text, item))
              .sort((a, b) => a.length - b.length)[0]
            throw new Error(`draft_experience_content_mismatch: record_${index + 1}:${differences?.join(',') || 'missing_or_duplicate'}`)
          }
        }
        await page.goto('https://hh.ru/profile/block/experience', { waitUntil: 'domcontentloaded', timeout: 120_000 })
        const cards = page.locator('[data-qa="profile-experience-company-card"]')
        if (items.length) await cards.first().waitFor({ state: 'visible', timeout: 15_000 })
        return await cards.allInnerTexts()
      }
      await page.goto(`https://hh.ru/resume/${resume.id}/experience`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const cards = page.locator('[data-qa="resume-block-experience-item"], ' +
        '[data-qa^="resume-list-card-experience-item-"], [data-qa="profile-experience-company-card"]')
      if (items.length) await cards.first().waitFor({ state: 'visible', timeout: 15_000 })
      if (![ `/resume/${resume.id}/experience`, `/resume/${resume.id}` ].includes(new URL(page.url()).pathname)) {
        throw new Error('resume_experience_identity_mismatch')
      }
      return await cards.allInnerTexts()
}

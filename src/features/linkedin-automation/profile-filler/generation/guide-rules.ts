export const LINKEDIN_GUIDE = {
  url: 'https://docs.google.com/document/d/14kT_k00qAqf69AbfCthQl4hXVy7HSdPcFuzC_S3vIFo/edit',
  revision: 'AIroW35MfvCNd3QIC_DofduS6FKSImG7lbe_JesKZbhiF5XnZuRCFAgiKcXP_vRk1j743OtyEINofh8tYU1SiRkkLwWiSuPxPZlt4iGIxnU',
  language: 'English',
  headlineMax: 220,
  aboutMax: 2600,
  experienceDescriptionMax: 2000,
  skillsTarget: 100,
  bannedPhrases: [
    'spearheaded', 'leveraged', 'driving significant impact',
    'delivered transformative outcomes'
  ]
} as const

export const GENERATION_RULES = `
Create only headline, about, skills, experience, education, and open_to_work.
Write the complete profile in English. Never emit Cyrillic or pseudo-bold Unicode.
Headline: at most 220 characters; target roles, years of experience, 2-3 core technologies.
About: emit about_blocks with 4-5 short blocks for introduction, evidence-backed achievements,
working approach, categorized technical stack, and contact call-to-action when contact data exists.
The joined blocks must be at most 2600 characters.
Never mention salary. Never use: spearheaded, leveraged, driving significant impact,
delivered transformative outcomes.
Skills: propose exactly 100 unique relevant skills, ordered AI, core stack, architecture,
databases, cloud/DevOps, testing, tools, methodologies, domain. target_count is exactly 100.
Every Experience and Education skill must exactly match one of these 100 skills.
The backend keeps existing profile Skills and adds only the number needed to reach 100 by name.
Experience: return exactly one addition for every exp_N fact_id, newest first. Return only fact_id,
description and 5-15 skills. The backend copies company, title, dates, location and workplace type
from CV facts. Descriptions use only achievements, responsibilities and technologies from that fact.
Education: return exactly one addition for every edu_N fact_id. Return only
fact_id, description and 5-15 skills. The backend copies all factual education fields from CV.
Open to Work: exactly five role variations, the supplied proxy country, REMOTE/HYBRID/ON_SITE,
IMMEDIATELY, FULL_TIME/CONTRACT/PART_TIME, visibility ALL.
Do not invent or change fact IDs. Do not add unsupported fields. Use null only where permitted.
`.trim()

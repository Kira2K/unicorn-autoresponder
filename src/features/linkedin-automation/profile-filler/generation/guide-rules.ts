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
Skills: exactly 100 unique relevant skills, ordered AI, core stack, architecture, databases,
cloud/DevOps, testing, tools, methodologies, domain. target_count is exactly 100.
Experience: include every CV position newest first. Keep company, title, and dates equal to the
extracted CV facts. Description is at most 2000 characters and uses achievements,
responsibilities, and technologies supported by the facts. Attach 5-15 skills. Never emit
experience employment_type. Every attached skill must also exist in profile.skills.add.
Education: include higher education only. Keep factual fields equal to the extracted CV facts.
Generic neutral description is allowed when details are absent. Attach at least 5 skills, all of
which must also exist in profile.skills.add.
Open to Work: exactly five role variations, the supplied proxy country, REMOTE/HYBRID/ON_SITE,
IMMEDIATELY, FULL_TIME/CONTRACT/PART_TIME, visibility ALL.
Do not add IDs to Experience or Education: MCP v2 accepts names there. Do not add unsupported
fields. Use null only where the output schema permits it.
`.trim()

export type SearchAudience = 'recruiter' | 'technical'

export type ConnectionSearchTemplate = {
  sourceKey: string
  audience: SearchAudience
  city: string
  keywordTemplate: string
  priority: number
  enabled: boolean
}

const CAPITALS_AND_TECH_HUBS = [
  'Abu Dhabi', 'Abuja', 'Accra', 'Addis Ababa', 'Algiers', 'Amman', 'Amsterdam',
  'Andorra la Vella', 'Ankara', 'Antananarivo', 'Apia', 'Ashgabat', 'Asmara',
  'Astana', 'Asuncion', 'Athens', 'Baghdad', 'Baku', 'Bamako', 'Bandar Seri Begawan',
  'Bangkok', 'Bangui', 'Banjul', 'Basseterre', 'Beijing', 'Beirut', 'Belgrade',
  'Belmopan', 'Berlin', 'Bern', 'Bishkek', 'Bissau', 'Bogota', 'Brasilia',
  'Bratislava', 'Brazzaville', 'Bridgetown', 'Brussels', 'Bucharest', 'Budapest',
  'Buenos Aires', 'Bujumbura', 'Cairo', 'Canberra', 'Caracas', 'Castries', 'Chisinau',
  'Conakry', 'Copenhagen', 'Dakar', 'Damascus', 'Dhaka', 'Dili', 'Djibouti', 'Dodoma',
  'Doha', 'Dublin', 'Dushanbe', 'Freetown', 'Funafuti', 'Gaborone', 'Georgetown',
  'Gitega', 'Guatemala City', 'Hanoi', 'Harare', 'Havana', 'Helsinki', 'Honiara',
  'Islamabad', 'Jakarta', 'Jerusalem', 'Juba', 'Kabul', 'Kampala', 'Kathmandu',
  'Khartoum', 'Kigali', 'Kingston', 'Kingstown', 'Kinshasa', 'Kuala Lumpur',
  'Kuwait City', 'Kyiv', 'Libreville', 'Lilongwe', 'Lima', 'Lisbon', 'Ljubljana',
  'Lome', 'London', 'Luanda', 'Lusaka', 'Luxembourg', 'Madrid', 'Majuro', 'Malabo',
  'Male', 'Managua', 'Manama', 'Manila', 'Maputo', 'Maseru', 'Mbabane', 'Mexico City',
  'Minsk', 'Mogadishu', 'Monaco', 'Monrovia', 'Montevideo', 'Moroni', 'Moscow',
  'Muscat', 'Nairobi', 'Nassau', 'Naypyidaw', "N'Djamena", 'New Delhi', 'Ngerulmud',
  'Niamey', 'Nicosia', 'Nouakchott', "Nuku'alofa", 'Oslo', 'Ottawa', 'Ouagadougou',
  'Palikir', 'Panama City', 'Paramaribo', 'Paris', 'Phnom Penh', 'Podgorica',
  'Port Louis', 'Port Moresby', 'Port of Spain', 'Port Vila', 'Porto-Novo', 'Prague',
  'Praia', 'Pretoria', 'Pyongyang', 'Quito', 'Rabat', 'Reykjavik', 'Riga', 'Riyadh',
  'Rome', 'Roseau', "Saint George's", "Saint John's", 'San Jose', 'San Marino',
  'San Salvador', "Sana'a", 'Santiago', 'Santo Domingo', 'Sao Tome', 'Sarajevo',
  'Seoul', 'Singapore', 'Skopje', 'Sofia', 'South Tarawa',
  'Sri Jayawardenepura Kotte', 'Stockholm', 'Sucre', 'Suva', 'Tallinn', 'Tashkent',
  'Tbilisi', 'Tegucigalpa', 'Tehran', 'Thimphu', 'Tirana', 'Tokyo', 'Tripoli', 'Tunis',
  'Ulaanbaatar', 'Vaduz', 'Valletta', 'Vatican City', 'Victoria', 'Vienna', 'Vientiane',
  'Vilnius', 'Warsaw', 'Washington DC', 'Wellington', 'Windhoek', 'Yamoussoukro',
  'Yaounde', 'Yerevan', 'Zagreb', 'Barcelona', 'Munich', 'San Francisco', 'Toronto',
  'Bangalore', 'Shenzhen', 'Dubai'
] as const

const RECRUITER_ROLES = [
  'IT Recruiter', 'Technical Recruiter', 'Tech Talent Acquisition',
  'Talent Acquisition Partner', 'Engineering Recruiter', 'Technology Recruiter',
  'IT Recruitment Consultant'
] as const

const TECHNICAL_ROLES = [
  '{stack} Software Engineer', '{stack} Developer', '{stack} QA Engineer',
  '{stack} Test Automation Engineer'
] as const

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function buildConnectionSearchCatalog(): ConnectionSearchTemplate[] {
  return CAPITALS_AND_TECH_HUBS.flatMap((city, index) => {
    const recruiterRole = RECRUITER_ROLES[index % RECRUITER_ROLES.length]
    const technicalRole = TECHNICAL_ROLES[index % TECHNICAL_ROLES.length]
    return [
      {
        sourceKey: `recruiter-${slug(city)}`,
        audience: 'recruiter' as const,
        city,
        keywordTemplate: `${recruiterRole} {stack} ${city}`,
        priority: index + 1,
        enabled: true
      },
      {
        sourceKey: `technical-${slug(city)}`,
        audience: 'technical' as const,
        city,
        keywordTemplate: `${technicalRole} ${city}`,
        priority: index + 1,
        enabled: true
      }
    ]
  })
}

export function renderSearchKeywords(template: ConnectionSearchTemplate, stack: string | undefined,
  safeRecruiterOnly = false): string {
  const replacement = safeRecruiterOnly ? 'IT' : String(stack ?? '').trim()
  return template.keywordTemplate.replaceAll('{stack}', replacement).replace(/\s+/g, ' ').trim()
}

export const CONNECTION_SEARCH_CATALOG = buildConnectionSearchCatalog()

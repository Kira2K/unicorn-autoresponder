type TableConfig = {
  key: string
  id: string
  title: string
}

const TABLES = {
  clients: {
    key: 'clients',
    id: 'mxza381054ldlza',
    title: 'clients'
  },
  companies: {
    key: 'companies',
    id: 'mcf5h0mryenmxec',
    title: 'companies_from_applications'
  },
  dolphinProfiles: {
    key: 'dolphinProfiles',
    id: 'm4thvbutfyb15qz',
    title: 'dolphin_profiles'
  },
  outreachSettings: {
    key: 'outreachSettings',
    id: 'm3e611iozk7wnew',
    title: 'client_outreach_settings'
  },
  contractsPayments: {
    key: 'contractsPayments',
    id: 'm6jmkkms6o6tkef',
    title: 'contracts_payments'
  },
  platformAccounts: {
    key: 'platformAccounts',
    id: 'm8zej2vsv4iypl8',
    title: 'platform_accounts'
  },
  platforms: {
    key: 'platforms',
    id: 'mg3ovkendur1kpo',
    title: 'platforms'
  },
  applications: {
    key: 'applications',
    id: 'mqgr5lv9raft8fm',
    title: 'applications_from_otkliki'
  },
  restrictions: {
    key: 'restrictions',
    id: 'm7bhicp99zq1wsg',
    title: 'client_company_restrictions_from_stop_companies'
  },
  stacks: {
    key: 'stacks',
    id: 'msr3ihfj0kjue1t',
    title: 'stacks'
  },
  dataStatuses: {
    key: 'dataStatuses',
    id: 'mvyrro4ko9tqu2b',
    title: 'data_collection_statuses'
  },
  resumeProfiles: {
    key: 'resumeProfiles',
    id: 'ms6218eaf2cqqr2',
    title: 'resume_sheet_profiles'
  },
  hhAutoresponses: {
    key: 'hhAutoresponses',
    id: 'mes5o0s90zwat1t',
    title: 'hh-autoresponses'
  },
  market: {
    key: 'market',
    id: 'molt1q7vu7peibh',
    title: 'market'
  },
  mentors: {
    key: 'mentors',
    id: 'mp1s5wh87xtdi6k',
    title: 'mentors'
  }
} as const

const RELATION_TABLE_KEYS = [
  'clients',
  'dolphinProfiles',
  'outreachSettings',
  'contractsPayments',
  'platformAccounts',
  'applications',
  'restrictions',
  'dataStatuses',
  'resumeProfiles',
  'hhAutoresponses'
] as const

const RELATIONS = {
  restrictionsBlockedCompanies: 'rel_restrictions_blocked_companies',
  dolphinProfilesClient: 'rel_dolphinProfiles_client'
} as const

module.exports = {
  RELATION_TABLE_KEYS,
  RELATIONS,
  TABLES
}

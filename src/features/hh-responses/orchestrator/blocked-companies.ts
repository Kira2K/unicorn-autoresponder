type ClientAutomationData = import('./types.ts').ClientAutomationData
type BlockedCompany = import('../../../../shared/company-stop-list.ts').BlockedCompany

// TODO(company-stop-list): replace this mock with blockedCompanies from the
// client profile DB record. Keep this data attached once per client before the
// run; never fetch stop-list data per vacancy inside the browser script.
const MOCK_BLOCKED_COMPANIES: BlockedCompany[] = [
  { id: 'mock-comtek', name: 'Comtek' },
  { id: 'mock-trynexis', name: 'Trynexis' }
]

function getMockBlockedCompaniesForClient(
  _client: ClientAutomationData
): BlockedCompany[] {
  return MOCK_BLOCKED_COMPANIES.map(company => ({ ...company }))
}

function attachBlockedCompanies(
  clients: ClientAutomationData[]
): ClientAutomationData[] {
  return clients.map(client => ({
    ...client,
    blockedCompanies: getMockBlockedCompaniesForClient(client)
  }))
}

module.exports = {
  MOCK_BLOCKED_COMPANIES,
  attachBlockedCompanies,
  getMockBlockedCompaniesForClient
}

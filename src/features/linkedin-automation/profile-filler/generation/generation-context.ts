import { codedError } from '../errors.ts'
import { selectFinalEnglishCv } from './cv-source.ts'

export function buildGenerationContext(options: {
  accounts: any[]; cvRows: any[]; platformAccountId: number
}) {
  const account = options.accounts.find(item =>
    Number(item.platformAccountId) === options.platformAccountId)
  if (!account) throw codedError('linkedin_account_not_found', 'LinkedIn account was not found.')
  if (!account.dolphinProfileId) throw codedError('dolphin_en_profile_not_found',
    'A single English Dolphin profile is required.')
  const cv = selectFinalEnglishCv(options.cvRows, account.clientId)
  return { account, cvUrl: cv.url, cvRevision: cv.revision }
}

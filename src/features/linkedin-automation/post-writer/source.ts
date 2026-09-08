import type { PostSource } from './types.ts'
import type { SourceDependencies } from './source-types.ts'
import { PostError } from './errors.ts'
import { digest } from './content-identity.ts'
import { FACTS_VERSION } from './fact-instructions.ts'
const MAX_CV_BYTES = 20 * 1024 * 1024

export function createPostSource(deps: SourceDependencies): PostSource {
  return {
    async accounts() {
      return (await deps.accounts()).filter(row => row.unipileAccountId &&
        row.verifiedProviderId && !row.readinessErrorCode && !row.authErrorCode &&
        row.unipileAccountStatus === 'running').map(row => ({ platformAccountId: row.platformAccountId,
          clientName: row.clientName, unipileAccountId: row.unipileAccountId!,
          verifiedProviderId: row.verifiedProviderId!, linkedinUrl: row.linkedinUrl }))
    },
    async context(account, previous) {
      const row = (await deps.accounts()).find(item => item.platformAccountId === account)
      if (!row) throw new PostError('post_account_missing')
      const cv = deps.selectCv(await deps.cvRows(), row.clientId)
      // Download/read-only metadata detects in-place edits even if the Noco link did not change.
      const document = await deps.loadCv(cv.url, MAX_CV_BYTES)
      const revision = digest(`${cv.revision}:${document.revision}:${digest(document.bytes.toString('base64'))}`)
      if (previous?.revision === revision && previous.factsVersion === FACTS_VERSION) return previous
      return { ...await deps.extractFacts(document), revision, factsVersion: FACTS_VERSION }
    }
  }
}

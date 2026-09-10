import { connectionError } from './errors.ts'
export function connectionAccountScope(accounts?: readonly number[]) {
  const allowed = accounts && new Set(accounts)
  const includes = (account: number) => !allowed || allowed.has(account)
  return { includes, assert(account: number) {
    if (!includes(account)) throw connectionError('connection_account_not_allowed',
      'Этот аккаунт не разрешён для текущего ручного запуска backend.')
  } }
}

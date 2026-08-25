import { codedError } from '../errors.ts'

export function driveFileId(value: string) {
  try {
    const url = new URL(value)
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname)) throw new Error()
    const pathId = url.pathname.match(/\/(?:d|file\/d)\/([\w-]+)/)?.[1]
    const id = pathId ?? url.searchParams.get('id') ?? ''
    if (!id) throw new Error()
    return id
  } catch {
    throw codedError('profile_cv_url_invalid', 'The final English CV URL is invalid.')
  }
}

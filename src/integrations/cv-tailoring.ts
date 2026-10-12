export type CvTailoringRequest = { fileName: string; mimeType: string; fileBuffer: Buffer; jobRequirements: string }
export type CvTailoringService = { tailorFromPdf(request: CvTailoringRequest): Promise<{ url: string }> }
export const CV_TAILORING_ENDPOINT = 'https://tailered-cv.onrender.com/cv-from-pdf'

/** Shared transport only. Caller owns authorization, request budget and durable recovery. */
export function createCvTailoringService(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): CvTailoringService {
  return { async tailorFromPdf(request) {
    const apiKey = String(env.CV_TAILORING_API_KEY ?? '').trim()
    if (!apiKey) throw Object.assign(Error('CV tailoring API key is not configured.'), { code: 'cv_tailoring_not_configured' })
    const form = new FormData()
    form.append('cv', new Blob([new Uint8Array(request.fileBuffer)], { type: 'application/pdf' }), request.fileName)
    form.append('jobRequirements', request.jobRequirements)
    const response = await fetchImpl(CV_TAILORING_ENDPOINT, { method: 'POST', headers: { 'x-api-key': apiKey }, body: form, signal: AbortSignal.timeout(180000), redirect: 'error' })
    if (!response.ok) throw Object.assign(Error(`CV tailoring API failed with ${response.status}`), { code: 'cv_tailoring_api_failed', status: response.status })
    const raw = (await response.text()).trim()
    let url = raw
    try { const value = JSON.parse(raw); url = typeof value === 'string' ? value : value?.url ?? value?.result ?? value?.fileUrl ?? '' } catch { /* plain URL response */ }
    if (typeof url !== 'string' || !url.trim()) throw Object.assign(Error('CV tailoring API returned an empty URL.'), { code: 'cv_tailoring_api_failed', status: response.status })
    return { url: url.trim() }
  } }
}

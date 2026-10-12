import { inspectPdf } from '../application_preparation/pdf.ts'
import type { PageDocument } from '../types.ts'

/** Public PDF job descriptions; no browser viewer, OCR, upload or AI. */
export async function readPostingPdf(url:string, fetchImpl:typeof fetch, inspect:typeof inspectPdf=inspectPdf):Promise<PageDocument|undefined>{
  if(!/\.pdf$/i.test(new URL(url).pathname))return
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(30000)})
  if([404,410].includes(response.status))return {url,text:'Posting unavailable',jobs:[],links:[],closedEvidence:`Official PDF returned HTTP ${response.status}`,method:'public-pdf'}
  if(!response.ok||!response.body)throw Error(`posting_pdf_http:${response.status}`)
  const parts:Uint8Array[]=[];let size=0
  for await(const part of response.body as unknown as AsyncIterable<Uint8Array>){
    size+=part.length;if(size>15*1024*1024)throw Error('posting_pdf_too_large');parts.push(part)
  }
  const {text}=await inspect(Buffer.concat(parts))
  // A title must actually occur in the PDF, never come from an inferred filename.
  const title=text.slice(0,600).match(/\b(?:(?:Senior|Middle|Junior|Lead|Staff|Principal)\s+)?(?:(?:Golang|Go|Java|Python|Full[ -]?stack|Front[ -]?end|Back[ -]?end|Software|System|Test|QA|PHP|AI)\s+)+(?:Engineer|Developer|Administrator)(?:\s*\/\s*Devops)?\b/i)?.[0]
  return {url,text,links:[],jobs:title?[{title,company:'',location:'',description:text,url,applyUrl:url}]:[],partial:!title,method:'public-pdf'}
}

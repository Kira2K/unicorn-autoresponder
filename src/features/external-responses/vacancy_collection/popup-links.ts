import type { Page, CDPSession } from 'playwright'

/** Observe job-link popups without opening them; ordinary reader policy owns any later navigation. */
export async function installPopupLinks(page: Page, network: CDPSession) {
  const capturePopups=() => {
    const links: {text:string;url:string}[]=[]
    const capture=(value:string|URL)=>{try{
      const text=document.documentElement.getAttribute('data-collection-popup-label'),url=new URL(String(value),location.href)
      if(text&&/^https?:$/.test(url.protocol)){links.push({text,url:url.href});document.documentElement.setAttribute('data-collection-popup-links',JSON.stringify(links))}
    }catch{}}
    window.open=(url?:string|URL)=>{if(url)capture(url);return null}
    const anchorClick=HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click=function(){
      if(this.target==='_blank'){capture(this.href);return}
      anchorClick.call(this)
    }
    document.addEventListener('click',event=>{
      const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[target="_blank"][href]'):null
      if(anchor){event.preventDefault();capture(anchor.href)}
    },true)
  }
  // Patchright isolates addInitScript/evaluate. The opener must be intercepted in
  // the site's main world before any document script runs; communication uses DOM.
  await network.send('Page.enable')
  await network.send('Page.addScriptToEvaluateOnNewDocument',{source:`(${capturePopups.toString()})()`})
  return {
    label:(text:string)=>page.evaluate(label=>document.documentElement.setAttribute('data-collection-popup-label',label),text),
    links:()=>page.evaluate(()=>JSON.parse(document.documentElement.getAttribute('data-collection-popup-links')??'[]') as {text:string;url:string}[]),
  }
}

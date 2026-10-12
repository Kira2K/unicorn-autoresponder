const labels=new Map<string,Set<string>>()
/** Recognize the destination language by its localized or English name, not employer-specific labels. */
export function isLanguageLabel(text:string,path:string) {
  const prefix=path.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i)?.[1].toLowerCase()
  if(!prefix)return false
  const locale=({gr:'el',ua:'uk'} as Record<string,string>)[prefix]??prefix
  let names=labels.get(locale)
  if(!names){
    names=new Set([locale,prefix])
    try {for(const code of new Set([locale,locale.split('-')[0]]))for(const language of ['en',locale]){const label=new Intl.DisplayNames([language],{type:'language'}).of(code);if(label)names.add(label.normalize('NFKC').toLowerCase())}}catch{}
    labels.set(locale,names)
  }
  return names.has(text.normalize('NFKC').trim().toLowerCase())
}

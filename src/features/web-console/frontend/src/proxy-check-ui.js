export const proxyCountryName=value=>({ES:'Испания',GE:'Грузия'})[value]||value||'не определена'
export function proxyCountryFailure(check){
 const expected=proxyCountryName(check?.expectedCountry)
 return check?.actualCountry
  ? `Страна прокси — ${proxyCountryName(check.actualCountry)}. Нужна ${expected}. Старый прокси сохранён.`
  : `Страна прокси не определена. Нужна ${expected}. Старый прокси сохранён.`
}
export function proxyCheckSuccess(check){
 return check?.exitIp?`Прокси работает. IP: ${check.exitIp}, страна: ${proxyCountryName(check.country)} — совпадает.`:''
}

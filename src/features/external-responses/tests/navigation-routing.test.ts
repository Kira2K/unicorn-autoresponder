import test from 'node:test'
import assert from 'node:assert/strict'
import { vacancyLinks } from '../vacancy_collection/navigation.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'

test('unseen languages use standard language names while named regional boards remain navigable',()=>{
 const page='https://company.test/en/careers-georgia'
 const links=[{text:'Greek',url:'https://company.test/gr/careers-georgia/'},{text:'Ελληνικά',url:'https://company.test/gr/careers-georgia/'},{text:'Svenska',url:'https://company.test/sv/careers-georgia/'},{text:'Swedish',url:'https://company.test/sv/careers-georgia/'},{text:'Sweden',url:'https://company.test/sv/careers-georgia/'}]
 assert.deepEqual(vacancyLinks(links,page).map(l=>l.text),['Sweden'])
})
test('explicit language-picker evidence handles nonstandard labels without discarding distinct country sections',()=>{
 const page='https://company.test/en/careers-uk/'
 const links=[{text:'Tagalog',url:'https://company.test/tl/careers-uk/',languageAlternative:true},{text:'Greek',url:'https://company.test/cy/careers-uk/',languageAlternative:true},{text:'Worldwide',url:'https://company.test/en/careers-global/',languageAlternative:true}]
 assert.deepEqual(vacancyLinks(links,page).map(l=>l.text),['Worldwide'])
})

test('careers region sections survive while explicit equivalent language switches do not',()=>{
 const base='https://company.test/en/careers/'
 const urls=vacancyLinks([{text:'Español',url:'https://company.test/es/careers/'},{text:'Deutsch',url:'https://company.test/de/careers/'},{text:'Tbilisi',url:'https://company.test/en/careers-georgia'},{text:'Worldwide',url:'https://company.test/en/careers-global'},{text:'Russian developer roles',url:'https://company.test/ru/careers/backend-engineer'}],base).map(l=>l.url)
 assert.deepEqual(new Set(urls),new Set(['https://company.test/en/careers-georgia','https://company.test/en/careers-global','https://company.test/ru/careers/backend-engineer']))
})
test('official named external careers links are followed, unrelated companies and forbidden destinations are not',()=>{
 const page='https://acme.test/'
 const links=[{text:'Acme Careers',url:'https://acme.notion.site/Acme-Careers-0123456789abcdef0123456789abcdef'},{text:'Other Careers',url:'https://other.notion.site/Other-Careers-0123456789abcdef0123456789abcdef'},{text:'Careers',url:'https://linkedin.com/company/acme'},{text:'Careers',url:'https://acme.test/signup'}]
 assert.deepEqual(vacancyLinks(links,page,'Acme').map(l=>l.url),[links[0].url])
})
test('observed BambooHR embed binds its employer board, never the vendor homepage',()=>{
 const links=vacancyLinks([{text:'Job openings',url:'https://acme.bamboohr.com/jobs/embed2.php'},{text:'Powered by BambooHR',url:'https://www.bamboohr.com/'}],'https://acme.test/careers','Acme')
 assert.deepEqual(links.map(l=>l.url),['https://acme.bamboohr.com/careers'])
})
test('shared navigation completes geographic sections without wasting the page budget on translations',async()=>{
 const source={name:'Acme',url:'https://acme.test/en/careers/'},visited:string[]=[]
 const result=await createWebsiteStrategy({maxPages:3,reader:{read:async url=>{visited.push(url);return url===source.url?{url,text:'Careers',jobs:[],links:[{text:'Deutsch',url:'https://acme.test/de/careers/'},{text:'London',url:'https://acme.test/en/careers-uk'},{text:'Worldwide',url:'https://acme.test/en/careers-global'}]}:{url,text:'No open positions',jobs:[],links:[],explicitlyEmpty:true}}}}).discover([source])
 assert.equal(result.audit[0].status,'complete');assert.equal(visited.length,3);assert.ok(visited.every(url=>!url.includes('/de/')))
})

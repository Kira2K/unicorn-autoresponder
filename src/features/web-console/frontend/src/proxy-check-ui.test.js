import {test} from 'node:test'
import assert from 'node:assert/strict'
import {proxyCountryFailure,proxyCheckSuccess} from './proxy-check-ui.js'
test('checked proxy displays exit IP and country while mismatch explains both countries',()=>{
 assert.equal(proxyCheckSuccess({exitIp:'203.0.113.25',country:'ES'}),'Прокси работает. IP: 203.0.113.25, страна: Испания — совпадает.')
 assert.equal(proxyCountryFailure({actualCountry:'GE',expectedCountry:'ES'}),'Страна прокси — Грузия. Нужна Испания. Старый прокси сохранён.')
 assert.equal(proxyCountryFailure({expectedCountry:'GE'}),'Страна прокси не определена. Нужна Грузия. Старый прокси сохранён.')
 assert.equal(proxyCheckSuccess(undefined),'')
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseProxyLine} from './proxy-line.js'
import {parseProxyInput} from '../../../octo-access/proxy-input.mts'
import {parseOwnSocksProxy} from '../../../octo-access/own-proxy-string.mts'
import {octoProxyPayload} from './octo-api.js'

test('provider host:port:login:password matches existing proxy parsers and save payload',()=>{
 const raw='gate.nodemaven.com:8080:fixture-country-us-region-california-sid-test-filter-medium:fixture:pass@#% word '
 const parsed=parseProxyLine(raw)
 assert.equal(parsed.password,'fixture:pass@#% word ')
 assert.equal(parsed.type,'socks5')
 assert.equal(parseProxyLine('proxy.example:1080:fixture:https://literal:password').password,'https://literal:password')
 assert.deepEqual(parseProxyInput(parsed),parsed)
 assert.deepEqual(octoProxyPayload(parsed),parsed)
 const compatible='gate.nodemaven.com:1080:fixture-country-us-sid-test:fixture:pass@#%'
 assert.deepEqual(parseProxyLine(compatible),parseOwnSocksProxy(compatible))
})
test('SOCKS5 URLs decode credentials once; other protocols are rejected',()=>{
 for(const scheme of ['socks5','socks5h']){
  const parsed=parseProxyLine(`${scheme}://u%40ser:p%253A%3Aword@proxy.example:1080`)
  assert.deepEqual(parsed,{type:'socks5',host:'proxy.example',port:1080,login:'u@ser',password:'p%3A:word'})
  assert.deepEqual(parseProxyInput(parsed),parsed)
 }
 for(const scheme of ['http','https','socks4'])
  assert.throws(()=>parseProxyLine(`${scheme}://user:private@proxy.example:1080`),{message:'proxy_line_protocol'})
})
test('anonymous and IPv6 connections retain field semantics',()=>{
 for(const raw of ['proxy.example:1080','socks5://proxy.example:1080'])
  assert.deepEqual(parseProxyLine(raw),{type:'socks5',host:'proxy.example',port:1080,login:'',password:''})
 assert.deepEqual(parseProxyLine('[2001:db8::1]:1080:user:pass:word'),{type:'socks5',host:'[2001:db8::1]',port:1080,login:'user',password:'pass:word'})
 assert.equal(parseProxyLine('socks5://user:pass@[2001:db8::1]:1080').host,'[2001:db8::1]')
 assert.equal(parseProxyLine('proxy.veunicorn.com:1080:user:literal%3A').password,'literal%3A')
})
test('malformed or multiline strings fail safely without exposing credentials',()=>{
 for(const raw of ['',null,'proxy.example:1080:user','proxy.example:0:user:private','proxy.example:65536:user:private',
  'proxy.example:no-port:user:private','proxy.example:1080:user:private\n','proxy.example:1080:user:private\rnext',
  'ftp://user:private@proxy.example:1080','socks5://proxy.example','socks5://user:%XX@proxy.example:1080',
  'socks5://user:private@proxy.example:1080/path','socks5://proxy.example:1080?secret=private',
  'socks5://proxy.example:1080#private','bad host:1080:user:private'])
  assert.throws(()=>parseProxyLine(raw),error=>/^proxy_line_[a-z]+$/.test(error.message)&&!String(error).includes('private'))
})

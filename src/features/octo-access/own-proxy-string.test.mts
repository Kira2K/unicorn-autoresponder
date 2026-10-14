import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnSocksProxy } from './own-proxy-string.mts';

test('plain SOCKS5 proxy input supports credentials with colons', () => {
  assert.deepEqual(parseOwnSocksProxy(' proxy.example:1080:user:pass:word '),
    { type: 'socks5', host: 'proxy.example', port: 1080, login: 'user', password: 'pass:word' });
  assert.deepEqual(parseOwnSocksProxy('proxy.example:1080'),
    { type: 'socks5', host: 'proxy.example', port: 1080, login: '', password: '' });
});

test('URL credentials decode once and socks5h normalizes to socks5', () => {
  assert.deepEqual(parseOwnSocksProxy('socks5h://u%40ser:p%253A%3Aword@proxy.example:1080'),
    { type: 'socks5', host: 'proxy.example', port: 1080, login: 'u@ser', password: 'p%3A:word' });
  assert.equal(parseOwnSocksProxy('socks5://proxy.example:1080').type, 'socks5');
});

test('other protocols, multiline, malformed URLs, missing port and extra URL components are rejected safely', () => {
  for (const input of ['http://proxy.example:1080', 'https://proxy.example:1080', 'socks4://proxy.example:1080',
    'proxy.example:1080\n', 'proxy.example:1080\rproxy.example:1080', 'proxy.example:1080:user', 'proxy.example:99999',
    'socks5://proxy.example', 'socks5://u:%XX@proxy.example:1080', 'socks5://proxy.example:1080/path',
    'socks5://proxy.example:1080?key=secret', 'socks5://proxy.example:1080#secret']) {
    assert.throws(() => parseOwnSocksProxy(input), (error: any) => error.code === 'octo_proxy_input_invalid' && !error.message.includes(input));
  }
});

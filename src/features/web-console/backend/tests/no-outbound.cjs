// Test preload: block provider/DB traffic, but allow tsx's local IPC pipe.
const net = require('node:net');
const originalConnect = net.Socket.prototype.connect;
function forbidden() {
  console.error('startup_test_outbound_blocked');
  throw Error('Unexpected outbound connection in startup test');
}
globalThis.fetch = forbidden;
require('node:http').request = forbidden;
require('node:https').request = forbidden;
require('node:tls').connect = forbidden;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const pipe = typeof first === 'string' ? first : first?.path;
  if (typeof pipe === 'string' && (pipe.startsWith('\\\\.\\pipe\\') || pipe.endsWith('.pipe')))
    return originalConnect.apply(this, args);
  return forbidden();
};

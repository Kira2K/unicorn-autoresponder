// Test-process-only guard. Never imported by application code.
const dotenv = require('dotenv');
dotenv.config = () => ({ parsed: {} });
dotenv.configDotenv = () => ({ parsed: {} });
process.loadEnvFile = () => { throw new Error('ENV file loading is disabled in mentor regression'); };
delete process.env.APP_DB;
delete process.env.CLIENTS_LOCAL_TEST_PORT;
delete process.env.CLIENTS_LOCAL_TEST_HOST;
delete process.env.MENTOR_BOT_API_KEY;
process.env.VEU_SUPPORT_BOT = 'synthetic';
process.env.WEB_CONSOLE_BOT_API_TOKEN = 'mentor-local-regression';
if (process.env.MENTOR_REGRESSION_MOCK_CONSOLE === '1') process.env.WEB_CONSOLE_USE_MOCK_DATA = 'true';
else delete process.env.WEB_CONSOLE_USE_MOCK_DATA;
const pg = require('pg');
const denySql = () => { throw new Error('Real SQL connections disabled in mentor regression'); };
pg.Pool.prototype.connect = denySql;
pg.Client.prototype.connect = denySql;
const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = first && typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!loopback.has(host || 'localhost')) throw new Error('External sockets disabled in mentor regression');
  return connect.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!loopback.has(url.hostname)) throw new Error('External HTTP disabled in mentor regression');
  return fetch(input, options);
};

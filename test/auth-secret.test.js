const { test } = require('node:test');
const assert = require('node:assert');

function load(env) {
  const saved = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET };
  Object.assign(process.env, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  delete require.cache[require.resolve('../auth/secret')];
  try { return require('../auth/secret'); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[require.resolve('../auth/secret')];
  }
}

test('production refuses to start without JWT_SECRET (no forgeable dev fallback)', () => {
  assert.throws(() => load({ NODE_ENV: 'production', JWT_SECRET: undefined }), /JWT_SECRET must be set/);
});

test('production uses the configured secret', () => {
  assert.equal(load({ NODE_ENV: 'production', JWT_SECRET: 'abc123' }).secretKey, 'abc123');
});

test('development keeps the local fallback', () => {
  assert.equal(load({ NODE_ENV: 'development', JWT_SECRET: undefined }).secretKey, 'your_secret_key');
});

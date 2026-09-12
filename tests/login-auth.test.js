const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('login page no longer references the removed meta element', () => {
  const html = read('login.html');
  assert.doesNotMatch(html, /getElementById\(["']meta["']\)/);
});

test('the backend local credential DB is seeded with demo users', () => {
  const data = JSON.parse(read('backend-vercel/data/users.db.json'));
  assert.ok(Array.isArray(data.users) && data.users.length > 0, 'backend local users should be seeded');
  assert.ok(data.users.some((user) => user.email === 'owner@store.com'), 'owner@store.com should exist');
});

test('frontend config does not force a public Supabase login by default', () => {
  const config = read('config.js');
  const localConfig = read('config.local.js');
  assert.doesNotMatch(config, /oisuwwdykgpghqcvbesj|sb_publishable_D8K21sPXMfV2lh_G_npiUA_-_SDzEbT/);
  assert.doesNotMatch(localConfig, /oisuwwdykgpghqcvbesj|sb_publishable_D8K21sPXMfV2lh_G_npiUA_-_SDzEbT/);
  assert.match(config, /window\.__ONECOUNTER_SUPABASE_URL__\s*=\s*""/);
  assert.match(config, /window\.__ONECOUNTER_SUPABASE_ANON_KEY__\s*=\s*""/);
  assert.match(localConfig, /window\.__ONECOUNTER_SUPABASE_URL__\s*=\s*""/);
  assert.match(localConfig, /window\.__ONECOUNTER_SUPABASE_ANON_KEY__\s*=\s*""/);
});

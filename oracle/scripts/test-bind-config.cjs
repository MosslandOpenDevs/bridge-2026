const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { loadBindingConfig } = require('./bind-config.cjs');

const SOURCE_ROOT = path.resolve(__dirname, '..');

function fixture(t, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'oracle');
  const scripts = path.join(appRoot, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const name of ['bind-config.cjs', 'deploy.sh']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(scripts, name));
  }
  fs.copyFileSync(path.join(SOURCE_ROOT, 'ecosystem.config.cjs'), path.join(appRoot, 'ecosystem.config.cjs'));
  if (contents !== undefined) {
    fs.writeFileSync(path.join(appRoot, 'config.local.json'), contents);
  }
  return appRoot;
}

function childEnv(extra = {}) {
  // Do not let the operator's configuration determine test expectations.
  return { ...process.env, DEPLOY_API_URL: '', DEPLOY_WEB_URL: '', ...extra };
}

function cli(appRoot, command, env = {}) {
  return spawnSync(process.execPath, [path.join(appRoot, 'scripts/bind-config.cjs'), command], {
    cwd: os.tmpdir(), // paths must not depend on the caller's current directory
    env: childEnv(env),
    encoding: 'utf8',
  });
}

function ecosystem(appRoot) {
  const result = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require(process.argv[1])))', path.join(appRoot, 'ecosystem.config.cjs')], {
    cwd: os.tmpdir(),
    env: childEnv({ HOST: '203.0.113.200' }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).apps;
}

test('missing file and empty object preserve default listeners and loopback health', (t) => {
  for (const contents of [undefined, '{}']) {
    const appRoot = fixture(t, contents);
    assert.deepEqual(loadBindingConfig(appRoot, { HOST: '203.0.113.200' }), {
      bindHost: undefined,
      apiUrl: 'http://127.0.0.1:3101',
      webUrl: 'http://127.0.0.1:3100',
    });
    const apps = ecosystem(appRoot);
    assert.equal(Object.hasOwn(apps.find((app) => app.name === 'oracle-api').env, 'HOST'), false);
    assert.deepEqual(apps.find((app) => app.name === 'oracle-web').args, ['start', '--port', '3100']);
  }
});

test('PM2 listeners and CLI health URLs share IPv4/IPv6 configuration', (t) => {
  for (const [input, host, urlHost] of [
    [' 192.0.2.20 ', '192.0.2.20', '192.0.2.20'],
    ['2001:0db8:0:0:0:0:0:20', '2001:db8::20', '[2001:db8::20]'],
    ['0.0.0.0', '0.0.0.0', '127.0.0.1'],
    ['0:0:0:0:0:0:0:0', '::', '[::1]'],
    ['::ffff:0.0.0.0', '::ffff:0:0', '127.0.0.1'],
  ]) {
    const appRoot = fixture(t, JSON.stringify({ bindHost: input }));
    const apps = ecosystem(appRoot);
    const api = apps.find((app) => app.name === 'oracle-api');
    const web = apps.find((app) => app.name === 'oracle-web');
    assert.equal(api.env.HOST, host);
    assert.equal(api.env.PORT, 3101);
    assert.deepEqual(web.args, ['start', '--port', '3100', '--hostname', host]);
    const apiUrl = cli(appRoot, 'api-url');
    const webUrl = cli(appRoot, 'web-url');
    assert.equal(apiUrl.status, 0, apiUrl.stderr);
    assert.equal(webUrl.status, 0, webUrl.stderr);
    assert.equal(apiUrl.stdout.trim(), `http://${urlHost}:3101`);
    assert.equal(webUrl.stdout.trim(), `http://${urlHost}:3100`);
  }
});

test('explicit URL overrides remain independent and do not change listeners', (t) => {
  const appRoot = fixture(t, '{"bindHost":"192.0.2.20"}');
  assert.equal(cli(appRoot, 'api-url', { DEPLOY_API_URL: 'https://api.example.test' }).stdout.trim(), 'https://api.example.test');
  assert.equal(cli(appRoot, 'web-url', { DEPLOY_API_URL: 'https://api.example.test' }).stdout.trim(), 'http://192.0.2.20:3100');
  assert.equal(cli(appRoot, 'web-url', { DEPLOY_WEB_URL: 'https://web.example.test' }).stdout.trim(), 'https://web.example.test');
  assert.equal(cli(appRoot, 'api-url', { DEPLOY_WEB_URL: 'https://web.example.test' }).stdout.trim(), 'http://192.0.2.20:3101');
  assert.equal(loadBindingConfig(appRoot, { DEPLOY_API_URL: 'https://api.example.test' }).bindHost, '192.0.2.20');
});

test('malformed configuration and typos fail without disclosing file contents', (t) => {
  const marker = 'private-value-must-not-appear';
  for (const contents of [
    `{ "${marker}":`,
    'null', '[]', 'true', '1', '"text"',
    JSON.stringify({ [marker]: '192.0.2.20' }),
    ...[null, 1, false, [], {}, '', '  ', marker, 'https://192.0.2.20', '192.0.2.20/32', '[::1]', 'fe80::1%eth0'].map((bindHost) => JSON.stringify({ bindHost })),
  ]) {
    const appRoot = fixture(t, contents);
    assert.throws(() => loadBindingConfig(appRoot, {}));
    const result = cli(appRoot, 'api-url', { DEPLOY_API_URL: 'https://override.example.test' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(marker), false);
    assert.match(result.stderr, /^Binding configuration: /);
  }
});

test('unreadable configuration never silently restores wildcard listening', (t) => {
  const appRoot = fixture(t);
  fs.mkdirSync(path.join(appRoot, 'config.local.json'));
  assert.throws(() => loadBindingConfig(appRoot, {}), /Cannot read config.local.json/);
});

test('deploy rejects invalid binding before lock, fetch, or checkout changes', (t) => {
  const appRoot = fixture(t, '{"bindHosts":"192.0.2.20"}');
  const result = spawnSync('bash', [path.join(appRoot, 'scripts/deploy.sh'), '--classify'], {
    input: 'oracle/apps/api/src/index.ts\n',
    env: childEnv({ DEPLOY_STATE: path.join(appRoot, 'state') }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /only accepts the bindHost key/);
  assert.equal(fs.existsSync(path.join(appRoot, 'logs')), false);
  assert.equal(fs.existsSync(path.join(appRoot, 'state')), false);
});

test('both services retain recovery spacing when the bind address is late', (t) => {
  const apps = ecosystem(fixture(t));
  for (const app of apps.filter((entry) => ['oracle-api', 'oracle-web'].includes(entry.name))) {
    assert.equal(app.autorestart, true);
    assert.equal(app.min_uptime, 1000);
    assert.equal(app.max_restarts, 10);
    // Even zero-runtime failures cannot consume the unstable restart budget
    // during PM2's min_uptime * max_restarts accounting window.
    assert.ok(app.restart_delay * (app.max_restarts - 1) > app.min_uptime * app.max_restarts);
  }
});

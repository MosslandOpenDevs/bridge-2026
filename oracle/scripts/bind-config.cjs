// Shared, host-local listener configuration. Never source an application .env
// into the deploy shell: it contains credentials and is not shell syntax.
const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');

const APP_ROOT = path.resolve(__dirname, '..');

function loadBindingConfig(appRoot = APP_ROOT, env = process.env) {
  let config = {};
  try {
    const raw = fs.readFileSync(path.join(appRoot, 'config.local.json'), 'utf8');
    try {
      config = JSON.parse(raw);
    } catch {
      // JSON parser errors can quote file contents. Only report the problem.
      throw new Error('config.local.json must contain valid JSON');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.code) throw new Error('Cannot read config.local.json');
      throw error;
    }
  }

  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('config.local.json must contain an object');
  }
  if (Object.keys(config).some((key) => key !== 'bindHost')) {
    throw new Error('config.local.json only accepts the bindHost key');
  }

  let bindHost;
  if (config.bindHost !== undefined) {
    if (typeof config.bindHost !== 'string') {
      throw new Error('config.local.json bindHost must be a numeric IP address');
    }
    bindHost = config.bindHost.trim();
    if (!isIP(bindHost) || bindHost.includes('%')) {
      throw new Error('config.local.json bindHost must be a numeric IP address without a zone');
    }
    // Canonicalize IPv6 so expanded spellings of the wildcard also map to
    // loopback, and URL callers always receive the required brackets.
    if (isIP(bindHost) === 6) {
      bindHost = new URL(`http://[${bindHost}]`).hostname.slice(1, -1);
    }
  }

  let healthHost = bindHost || '127.0.0.1';
  if (healthHost === '0.0.0.0' || healthHost === '::ffff:0:0') healthHost = '127.0.0.1';
  if (healthHost === '::') healthHost = '::1';
  if (isIP(healthHost) === 6) healthHost = `[${healthHost}]`;

  return {
    bindHost,
    apiUrl: env.DEPLOY_API_URL || `http://${healthHost}:3101`,
    webUrl: env.DEPLOY_WEB_URL || `http://${healthHost}:3100`,
  };
}

module.exports = { loadBindingConfig };

if (require.main === module) {
  try {
    const command = process.argv[2];
    if (process.argv.length !== 3 || !['api-url', 'web-url'].includes(command)) {
      throw new Error('Usage: node scripts/bind-config.cjs api-url|web-url');
    }
    const config = loadBindingConfig();
    console.log(command === 'api-url' ? config.apiUrl : config.webUrl);
  } catch (error) {
    console.error(`Binding configuration: ${error.message}`);
    process.exitCode = 1;
  }
}

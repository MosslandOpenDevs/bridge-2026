const { loadBindingConfig } = require('./scripts/bind-config.cjs');
const { bindHost } = loadBindingConfig(__dirname);

module.exports = {
  apps: [
    {
      name: 'oracle-api',
      cwd: './apps/api',
      // Production runs the compiled output (deploy.sh builds apps/api/dist
      // BEFORE any restart). This used to be `tsx watch src/index.ts`, which
      // hot-reloaded half-updated sources the moment deploy.sh ran its
      // `git reset --hard` -- i.e. before `pnpm install` and the builds --
      // crash-looping the API on every commit that added a dependency.
      // Production never hot-reloads: a deploy restart is the only reload.
      script: './dist/index.js',
      interpreter: 'node',
      // NODE_ENV lives in `env`, not only in `env_production`. PM2 applies
      // `env` unless it is started with `--env production`, and deploy.sh
      // restarts without that flag -- so an env_production block alone never
      // takes effect here, and every production-only guard in the API (the
      // ADMIN_API_KEY requirement, the execution timelock, the minimum voting
      // period, error sanitization) would stay switched off on the deployed
      // process.
      env: {
        PORT: 3101,
        NODE_ENV: 'production',
        // Omit HOST when unconfigured, preserving existing .env behavior.
        // Removing a previous binding also requires clearing PM2's saved HOST.
        ...(bindHost ? { HOST: bindHost } : {}),
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      // A private interface can appear after PM2 during boot. PM2 counts
      // unstable starts only inside min_uptime * max_restarts; spacing them
      // beyond that budget keeps retrying until the address is available.
      min_uptime: 1000,
      restart_delay: 5000,
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: 'oracle-web',
      cwd: './apps/web',
      script: './node_modules/.bin/next',
      // Next's CLI does not read HOST; pass its hostname option explicitly.
      args: ['start', '--port', '3100', ...(bindHost ? ['--hostname', bindHost] : [])],
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: '',
      },
      env_production: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: '',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      // Same late-interface recovery policy as oracle-api above.
      min_uptime: 1000,
      restart_delay: 5000,
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      // Pull-based auto-deploy (same pattern as algora-deploy / moss-ao-deploy):
      // a one-shot script pm2 re-runs on a cron schedule. The :03 offset
      // staggers it against algora (:01) and moss-ao (:04) on the shared box.
      name: 'bridge-deploy',
      cwd: '.',
      script: './scripts/deploy.sh',
      interpreter: 'bash',
      autorestart: false,
      cron_restart: '3-59/5 * * * *',
      watch: false,
      error_file: './logs/deploy-error.log',
      out_file: './logs/deploy-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      // Daily verified SQLite backup (apps/api/scripts/db-backup.cjs): VACUUM
      // INTO, quick_check, sha256, rotation, optional rsync off the host.
      // Opt-in like bridge-deploy -- registered only by
      // `pm2 start ecosystem.config.cjs --only bridge-db-backup`, see
      // deploy/README.md "Scheduled backups & restore". pm2 evaluates the cron
      // in the server's local time. :17 is off the 5-minute grid the pollers
      // on this box tick on (algora :01, bridge :03, moss-ao :04); a deploy
      // snapshot that does overlap is harmless -- both copies read the live
      // database through read-only handles.
      // Settings (BACKUP_*) are read from apps/api/.env by the script itself.
      name: 'bridge-db-backup',
      cwd: '.',
      script: './apps/api/scripts/db-backup.cjs',
      interpreter: 'node',
      autorestart: false,
      cron_restart: '17 4 * * *',
      watch: false,
      error_file: './logs/db-backup-error.log',
      out_file: './logs/db-backup-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};

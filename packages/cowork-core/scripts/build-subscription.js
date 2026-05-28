const path = require('node:path');
const { spawnSync } = require('node:child_process');

const env = {
  ...process.env,
  VELUGA_SUBSCRIPTION_LOGIN_ENABLED: 'true',
  VELUGA_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH: 'true',
  VELUGA_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI: 'true',
  VITE_SUBSCRIPTION_LOGIN: 'true',
  VITE_SUBSCRIPTION_LOGIN_CHATGPT_PLUS_OAUTH: 'true',
  VITE_SUBSCRIPTION_LOGIN_CLAUDE_PRO_CLI: 'true',
};

const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'];

const result = spawnSync(command, args, {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);

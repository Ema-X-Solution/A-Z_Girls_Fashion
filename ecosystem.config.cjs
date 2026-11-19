module.exports = {
  apps: [{
    name: 'az-fashion-api',
    cwd: '/srv/az-fashion',
    script: 'apps/api/dist/server.js',
    interpreter: 'node',
    env: { NODE_ENV: 'production' },
    env_file: '/etc/az-fashion/app.env',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '512M',
    time: true,
  }],
};

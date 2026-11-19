module.exports = {
  apps: [{
    name: 'az-fashion-api',
    cwd: '/srv/az-fashion',
    script: 'scripts/start-production.sh',
    interpreter: 'bash',
    env: { NODE_ENV: 'production' },
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '512M',
    time: true,
  }],
};

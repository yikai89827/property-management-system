module.exports = {
  apps: [
    {
      name: 'pms-server',
      cwd: '/opt/pms/apps/server',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      out_file: '/var/log/pms/out.log',
      error_file: '/var/log/pms/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};

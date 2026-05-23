module.exports = {
  apps: [
    {
      name: 'crochetflix-api',
      script: '/var/www/crochetflix/backend/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      error_file: '/var/log/crochetflix-error.log',
      out_file: '/var/log/crochetflix-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 10000
    }
  ]
};

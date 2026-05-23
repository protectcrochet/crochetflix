module.exports = {
  apps: [
    {
      name: 'crochetflix-api',
      script: '/var/www/crochetflix/backend/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      error_file: '/var/log/crochetflix-error.log',
      out_file: '/var/log/crochetflix-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};

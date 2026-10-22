// pm2 process file: `npm i -g pm2 && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`
// Restarts the server after a crash or when it uses too much memory, and keeps logs.
module.exports = {
    apps: [{
        name: 'sim-camp',
        script: 'server.js',
        instances: 1,            // keep ONE instance: camp locks and live boards live in this process
        exec_mode: 'fork',
        autorestart: true,
        max_restarts: 50,
        restart_delay: 2000,
        max_memory_restart: '600M',
        kill_timeout: 12000,     // matches the graceful shutdown in server.js
        env: { NODE_ENV: 'production', PORT: 3000 }
    }]
};

// pm2 process file: `npm i -g pm2 && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`
// Restarts the server after a crash or when it uses too much memory, and keeps logs.
module.exports = {
    apps: [{
        name: 'sim-camp',
        script: 'server.js',
        // With Firebase several instances can run side by side (see README, "چند نسخه از سرور"):
        // set instances: 'max' and exec_mode: 'cluster'. Keep 1 with DB_ADAPTER=memory.
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        max_restarts: 50,
        restart_delay: 2000,
        max_memory_restart: '600M',
        kill_timeout: 12000,     // matches the graceful shutdown in server.js
        env: { NODE_ENV: 'production', PORT: 3000 }
    }]
};

// PM2 process definitions for production (`pnpm start`).
//
// Two independently-managed processes under one PM2 daemon so the web server can
// be cycled on demand (`pnpm cycle-web`) without bouncing the client daemon — the
// daemon keeps its terminal/agent sessions alive and auto-reconnects over WS when
// web comes back up.
//
// Env contract mirrors `.env.example`:
//   PORT             web listen port (default 3000)
//   ENGY_SERVER_URL  client → web URL (default http://localhost:<PORT>)
//   ENGY_DIR         data directory (default ~/.engy, resolved by each process)
const path = require('node:path');

const PORT = process.env.PORT || '3000';
const ENGY_SERVER_URL = process.env.ENGY_SERVER_URL || `http://localhost:${PORT}`;

// Forward ENGY_DIR only when set, so PM2 never injects the literal string
// "undefined" (which would defeat each process's own default resolution).
const dataDir = process.env.ENGY_DIR ? { ENGY_DIR: process.env.ENGY_DIR } : {};

module.exports = {
  apps: [
    {
      name: 'engy-web',
      cwd: path.join(__dirname, 'web'),
      script: 'dist-server/server.mjs',
      env: { ...dataDir, NODE_ENV: 'production', PORT },
    },
    {
      name: 'engy-client',
      cwd: path.join(__dirname, 'client'),
      script: 'dist/index.js',
      env: { ...dataDir, ENGY_SERVER_URL },
    },
  ],
};

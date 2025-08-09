/**
 * mingle_server.js
 * Mini README:
 * - Purpose: serve the Mingle client and synchronise avatars via Socket.io.
 * - Structure:
 *   1. Configuration flags (port, host, HTTPS, debug)
 *   2. Server creation (HTTP/HTTPS)
 *   3. Static routes and config endpoint
 *   4. Socket.io events for position updates
 *   5. Startup logging with LAN-friendly addresses
 * - Notes: set LISTEN_HOST=0.0.0.0 to allow LAN clients. Use --debug for verbose logs.
 */
const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

// Port and host are configurable via environment variables. LISTEN_HOST is used
// rather than HOST to avoid clashing with shells that define HOST by default
// (which can inadvertently bind the server to an unreachable address).
// Default host 0.0.0.0 exposes the server on all network interfaces.
const PORT = process.env.PORT || 3000;
const HOST = process.env.LISTEN_HOST || '0.0.0.0';
const PROD = process.env.PROD === 'true';
// Enable HTTPS by setting USE_HTTPS=true and providing certificate paths
const USE_HTTPS = process.env.USE_HTTPS === 'true';
const KEY_PATH = process.env.SSL_KEY || path.join(__dirname, 'certs', 'mingle.key');
const CERT_PATH = process.env.SSL_CERT || path.join(__dirname, 'certs', 'mingle.cert');
// Optional debug flag enabled via the --debug command line argument.
// When active, additional runtime information is printed to the console which
// assists in diagnosing issues during development.
const DEBUG = process.argv.includes('--debug');

const app = express();

// Create either an HTTP or HTTPS server depending on configuration. When HTTPS
// is enabled the provided certificate is loaded. Fail early if certificates are
// missing to aid troubleshooting.
let server;
if (USE_HTTPS) {
  try {
    const options = {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
    };
    server = https.createServer(options, app);
  } catch (err) {
    console.error('Failed to start HTTPS server. Check certificate paths.', err);
    process.exit(1);
  }
} else {
  server = http.createServer(app);
}
const io = new Server(server);

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Expose a small configuration script that allows the client to know if
// debugging was requested when starting the server. The script simply defines
// a global variable that the browser can check.
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.MINGLE_DEBUG = ${DEBUG};`);
});

io.on('connection', (socket) => {
  // Always log client connections. Additional details are logged when in
  // debug mode to aid troubleshooting networking issues.
  console.log(`Client connected: ${socket.id}`);

  // Forward position data to all clients
  socket.on('position', (data) => {
    // Echo the data to every client, including the sender. Clients ignore
    // updates from themselves, ensuring that all connected participants are
    // aware of each other's avatars even if they connect later.
    io.emit('position', { id: socket.id, ...data });
    if (DEBUG) {
      console.log(`Position from ${socket.id}:`, data);
    }
  });

  socket.on('disconnect', () => {
    // Disconnection events are always logged. In debug mode we can provide
    // further context if needed.
    console.log(`Client disconnected: ${socket.id}`);
    socket.broadcast.emit('disconnectClient', socket.id);
  });
});

server.listen(PORT, HOST, () => {
  const protocol = USE_HTTPS ? 'https' : 'http';
  // Determine accessible addresses. When HOST is 0.0.0.0 we list all local
  // IPv4 interfaces so users can easily connect over a LAN.
  const addresses = [];
  if (HOST === '0.0.0.0') {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push(`${protocol}://${net.address}:${PORT}`);
        }
      }
    }
  } else {
    addresses.push(`${protocol}://${HOST}:${PORT}`);
  }
  console.log(`Mingle server running in ${PROD ? 'production' : 'development'} mode`);
  console.log('Accessible at:', addresses.join(', '));
  if (DEBUG) {
    console.log('Debug mode enabled');
  }
  if (USE_HTTPS) {
    console.log('HTTPS enabled. Certificates loaded from:', KEY_PATH, CERT_PATH);
  }
});

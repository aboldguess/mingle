/**
 * mingle_server.ts
 * Mini README:
 * - Purpose: serve the Mingle client and synchronise avatars via Socket.io.
 * - Structure:
 *   1. Configuration flags (port, host, HTTPS, debug)
 *   2. Server creation (HTTP/HTTPS)
 *   3. Static routes and config endpoint
 *   4. Socket.io events for position, participant count and WebRTC signalling
 *   5. Startup logging with LAN-friendly addresses and HTTP/HTTPS guidance
 * - Notes: set LISTEN_HOST=0.0.0.0 to allow LAN clients. Use --debug for verbose logs.
 */
import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import os from 'os';
import { Server } from 'socket.io';

// Port and host are configurable via environment variables. LISTEN_HOST is used
// rather than HOST to avoid clashing with shells that define HOST by default
// (which can inadvertently bind the server to an unreachable address).
// Default host 0.0.0.0 exposes the server on all network interfaces.
const PORT: number = Number(process.env.PORT) || 3000;
const HOST: string = process.env.LISTEN_HOST || '0.0.0.0';
const PROD: boolean = process.env.PROD === 'true';
// Enable HTTPS by setting USE_HTTPS=true and providing certificate paths
const USE_HTTPS: boolean = process.env.USE_HTTPS === 'true';
const KEY_PATH: string = process.env.SSL_KEY || path.join(__dirname, '../certs', 'mingle.key');
const CERT_PATH: string = process.env.SSL_CERT || path.join(__dirname, '../certs', 'mingle.cert');
// Optional debug flag enabled via the --debug command line argument.
// When active, additional runtime information is printed to the console which
// assists in diagnosing issues during development.
const DEBUG: boolean = process.argv.includes('--debug');

const app = express();

// Create either an HTTP or HTTPS server depending on configuration. When HTTPS
// is enabled the provided certificate is loaded. Fail early if certificates are
// missing to aid troubleshooting.
let server: http.Server | https.Server;
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

// Serve static assets from public directory. When compiled, __dirname points to
// the dist folder so we resolve the public assets relative to the project root.
app.use(express.static(path.join(__dirname, '../public')));

// Expose a small configuration script that allows the client to know if
// debugging was requested when starting the server. The script simply defines
// a global variable that the browser can check.
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`window.MINGLE_DEBUG = ${DEBUG};`);
});

interface PositionData {
  [key: string]: number;
}

io.on('connection', (socket) => {
  // Always log client connections. Additional details are logged when in
  // debug mode to aid troubleshooting networking issues.
  console.log(`Client connected: ${socket.id}`);
  io.emit('clientCount', io.engine.clientsCount);

  // Forward position data to all clients
  socket.on('position', (data: PositionData) => {
    // Echo the data to every client, including the sender. Clients ignore
    // updates from themselves, ensuring that all connected participants are
    // aware of each other's avatars even if they connect later.
    io.emit('position', { id: socket.id, ...data });
    if (DEBUG) {
      console.log(`Position from ${socket.id}:`, data);
    }
  });

  // Relay WebRTC signalling messages between clients. These events allow
  // browsers to negotiate peer-to-peer connections used for webcam video.
  socket.on('rtc-offer', ({ to, offer }) => {
    socket.to(to).emit('rtc-offer', { from: socket.id, offer });
    if (DEBUG) {
      console.log(`RTC offer from ${socket.id} to ${to}`);
    }
  });
  socket.on('rtc-answer', ({ to, answer }) => {
    socket.to(to).emit('rtc-answer', { from: socket.id, answer });
    if (DEBUG) {
      console.log(`RTC answer from ${socket.id} to ${to}`);
    }
  });
  socket.on('ice-candidate', ({ to, candidate }) => {
    socket.to(to).emit('ice-candidate', { from: socket.id, candidate });
    if (DEBUG && candidate) {
      console.log(`ICE candidate from ${socket.id} to ${to}`);
    }
  });

  socket.on('disconnect', () => {
    // Disconnection events are always logged. In debug mode we can provide
    // further context if needed.
    console.log(`Client disconnected: ${socket.id}`);
    socket.broadcast.emit('disconnectClient', socket.id);
    io.emit('clientCount', io.engine.clientsCount);
  });
});

server.listen(PORT, HOST, () => {
  const protocol = USE_HTTPS ? 'https' : 'http';
  // Determine accessible addresses. When HOST is 0.0.0.0 we list all local
  // IPv4 interfaces so users can easily connect over a LAN.
  const addresses: string[] = [];
  if (HOST === '0.0.0.0') {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      const netArray = nets[name] || [];
      for (const net of netArray) {
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
  } else {
    console.warn('HTTP mode: remote browsers may block webcams and sensors. Start with USE_HTTPS=true for full functionality.');
  }
});

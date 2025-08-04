const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// Simple Express server serving static files and Socket.io for real-time communication.
// Port is configurable via PORT environment variable. Default is 3000.
const PORT = process.env.PORT || 3000;
const PROD = process.env.PROD === 'true';
// Optional debug flag enabled via the --debug command line argument.
// When active, additional runtime information is printed to the console which
// assists in diagnosing issues during development.
const DEBUG = process.argv.includes('--debug');

const app = express();
const server = http.createServer(app);
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
    // Echo the data to other clients to keep avatars in sync.
    socket.broadcast.emit('position', { id: socket.id, ...data });
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

server.listen(PORT, () => {
  console.log(`Mingle server running on port ${PORT} in ${PROD ? 'production' : 'development'} mode`);
  if (DEBUG) {
    console.log('Debug mode enabled');
  }
});

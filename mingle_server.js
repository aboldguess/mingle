const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// Simple Express server serving static files and Socket.io for real-time communication.
// Port is configurable via PORT environment variable. Default is 3000.
const PORT = process.env.PORT || 3000;
const PROD = process.env.PROD === 'true';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Forward position data to all clients
  socket.on('position', (data) => {
    socket.broadcast.emit('position', { id: socket.id, ...data });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    socket.broadcast.emit('disconnectClient', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Mingle server running on port ${PORT} in ${PROD ? 'production' : 'development'} mode`);
});

/**
 * mingle_server.ts
 * Mini README:
 * - Purpose: serve the Mingle client, synchronise avatars via Socket.io and
 *   expose a secure admin API for world configuration.
 * - Structure:
 *   1. Configuration flags (port, host, HTTPS, debug, admin token)
 *   2. Server creation (HTTP/HTTPS)
 *   3. Middleware, static routes and world config endpoints (public GET, admin POST)
 *   4. Socket.io events for position, participant count and WebRTC signalling
 *   5. Asset upload, listing and deletion endpoints for avatar models
 *   6. Avatar refresh broadcasts when world configuration changes
 *   7. Startup logging with LAN-friendly addresses and HTTP/HTTPS guidance
 * - Notes: set LISTEN_HOST=0.0.0.0 to allow LAN clients. Use --debug for verbose logs.
 */
import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import os from 'os';
import multer from 'multer';
import { Server } from 'socket.io';

// Enable JSON parsing early so API endpoints can accept JSON bodies.
// This middleware is registered before any routes.
const app = express();
app.use(express.json());

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
// Optional admin token enables world configuration endpoints. Without this
// token set the admin interface is disabled for security.
const ADMIN_TOKEN: string | undefined = process.env.ADMIN_TOKEN;

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

// In-memory world configuration. The admin page can fetch and update these
// values via a small REST API guarded by a token header. Design properties such
// as geometry and colour are included so the environment can be themed without
// redeploying the server.
interface WorldConfig {
  worldName: string;
  maxParticipants: number;
  welcomeMessage: string;
  worldGeometry: string;
  worldColor: string;
  defaultBodyId?: string;
  defaultTvId?: string;
  tvPosition?: { x: number; y: number; z: number };
  webcamOffset?: { x: number; y: number; z: number; scale: number };
}
const worldConfig: WorldConfig = {
  worldName: 'Mingle World',
  maxParticipants: 20,
  welcomeMessage: 'Welcome to Mingle',
  worldGeometry: 'plane',
  worldColor: '#00aaff',
  defaultBodyId: undefined,
  defaultTvId: undefined,
  tvPosition: { x: 0, y: 1, z: 0 },
  webcamOffset: { x: 0, y: 0, z: 0.2, scale: 1 },
};

// Avatar asset storage lives under /public/assets. Metadata about uploaded
// models is persisted in asset-manifest.json so clients can discover available
// bodies and TV heads. Uploaded body and TV models are now stored in dedicated
// subdirectories to keep binary assets organised.
const assetsDir = path.join(__dirname, '../public/assets');
const bodyAssetsDir = path.join(assetsDir, 'bodies');
const tvAssetsDir = path.join(assetsDir, 'tvs');
const manifestPath = path.join(assetsDir, 'asset-manifest.json');
fs.mkdirSync(bodyAssetsDir, { recursive: true });
fs.mkdirSync(tvAssetsDir, { recursive: true });

interface AssetEntry {
  id: string;
  filename: string;
  scale: number;
  size?: number; // file size in bytes
  uploaded?: number; // unix epoch ms when uploaded
  screen?: { x: number; y: number; width: number; height: number };
}
interface AssetManifest {
  bodies: AssetEntry[];
  tvs: AssetEntry[];
}

function readManifest(): AssetManifest {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AssetManifest;
  } catch {
    return { bodies: [], tvs: [] };
  }
}

function writeManifest(manifest: AssetManifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// Multer storage chooses the destination directory based on the asset type
// encoded in the request path. Filenames are sanitised to avoid directory
// traversal and ensure consistent URLs in the manifest.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dest = (req.params as { type?: string }).type === 'tv' ? tvAssetsDir : bodyAssetsDir;
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      const safe = Date.now() + '-' + file.originalname.replace(/[^a-z0-9.-]/gi, '_');
      cb(null, safe);
    }
  }),
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.glb') {
      cb(null, true);
    } else {
      cb(new Error('Only .glb files allowed'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

function verifyAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_TOKEN) {
    return res.status(503).send('Admin interface disabled');
  }
  const token = req.header('x-admin-token');
  if (token !== ADMIN_TOKEN) {
    return res.status(401).send('Unauthorized');
  }
  next();
}

// Always expose the current world configuration so clients can align default
// assets and TV placement without an admin token. Admin-only modifications are
// guarded separately below.
app.get('/world-config', (_req, res) => {
  res.json(worldConfig);
});

if (ADMIN_TOKEN) {
  app.post('/world-config', verifyAdmin, (req, res) => {
    const { worldName, maxParticipants, welcomeMessage, worldGeometry, worldColor, defaultBodyId, defaultTvId, tvPosition, webcamOffset } = req.body;
    if (typeof worldName === 'string') {
      worldConfig.worldName = worldName;
    }
    if (typeof maxParticipants === 'number') {
      worldConfig.maxParticipants = maxParticipants;
    }
    if (typeof welcomeMessage === 'string') {
      worldConfig.welcomeMessage = welcomeMessage;
    }
    const allowedGeometries = ['plane', 'cube', 'sphere'];
    if (typeof worldGeometry === 'string' && allowedGeometries.includes(worldGeometry)) {
      worldConfig.worldGeometry = worldGeometry;
    }
    if (typeof worldColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(worldColor)) {
      worldConfig.worldColor = worldColor;
    }
    if (typeof defaultBodyId === 'string') {
      worldConfig.defaultBodyId = defaultBodyId;
    }
    if (typeof defaultTvId === 'string') {
      worldConfig.defaultTvId = defaultTvId;
    }
    if (tvPosition && typeof tvPosition === 'object') {
      const { x, y, z } = tvPosition;
      worldConfig.tvPosition = {
        x: typeof x === 'number' ? x : worldConfig.tvPosition?.x || 0,
        y: typeof y === 'number' ? y : worldConfig.tvPosition?.y || 0,
        z: typeof z === 'number' ? z : worldConfig.tvPosition?.z || 0,
      };
    }
    if (webcamOffset && typeof webcamOffset === 'object') {
      const { x, y, z, scale } = webcamOffset;
      worldConfig.webcamOffset = {
        x: typeof x === 'number' ? x : worldConfig.webcamOffset?.x || 0,
        y: typeof y === 'number' ? y : worldConfig.webcamOffset?.y || 0,
        z: typeof z === 'number' ? z : worldConfig.webcamOffset?.z || 0,
        scale: typeof scale === 'number' ? scale : worldConfig.webcamOffset?.scale || 1,
      };
    }
    console.log('World configuration updated:', worldConfig);
    io.emit('updateAvatars', worldConfig); // notify connected clients to refresh
    res.json({ status: 'ok' });
  });

  app.post('/api/assets/:type', verifyAdmin, upload.single('model'), (req, res) => {
    const { type } = req.params as { type: 'body' | 'tv' };
    const { scale, screenX, screenY, screenW, screenH } = req.body;
    if (!req.file || (type !== 'body' && type !== 'tv')) {
      return res.status(400).send('Invalid upload');
    }
    const manifest = readManifest();
    const subdir = type === 'tv' ? 'tvs' : 'bodies';
    const entry: AssetEntry = {
      id: Date.now().toString(),
      filename: path.posix.join(subdir, req.file.filename),
      scale: parseFloat(scale) || 1,
      size: req.file.size,
      uploaded: Date.now(),
    };
    if (type === 'tv') {
      entry.screen = {
        x: parseFloat(screenX) || 0,
        y: parseFloat(screenY) || 0,
        width: parseFloat(screenW) || 1,
        height: parseFloat(screenH) || 1,
      };
      manifest.tvs.push(entry);
    } else {
      manifest.bodies.push(entry);
    }
    try {
      writeManifest(manifest);
      console.log('Asset uploaded:', entry.filename);
      res.json({ status: 'ok', asset: entry });
    } catch (err) {
      console.error('Failed to save manifest', err);
      res.status(500).send('Manifest write failed');
    }
  });

  app.put('/api/assets/:type/:id', verifyAdmin, (req, res) => {
    const { type, id } = req.params as { type: 'body' | 'tv'; id: string };
    const { scale, screen } = req.body;
    const manifest = readManifest();
    const list = type === 'tv' ? manifest.tvs : manifest.bodies;
    const item = list.find((e) => e.id === id);
    if (!item) {
      return res.status(404).send('Asset not found');
    }
    if (typeof scale === 'number') {
      item.scale = scale;
    }
    if (type === 'tv' && screen) {
      const { x, y, width, height } = screen;
      item.screen = {
        x: typeof x === 'number' ? x : item.screen?.x || 0,
        y: typeof y === 'number' ? y : item.screen?.y || 0,
        width: typeof width === 'number' ? width : item.screen?.width || 1,
        height: typeof height === 'number' ? height : item.screen?.height || 1,
      };
    }
    try {
      writeManifest(manifest);
      console.log('Asset updated:', id);
      res.json({ status: 'ok', asset: item });
    } catch (err) {
      console.error('Failed to update asset', err);
      res.status(500).send('Update failed');
    }
  });

  // Allow administrators to delete uploaded assets. Removing an entry also
  // clears the associated file from disk to avoid orphaned binaries.
  app.delete('/api/assets/:type/:id', verifyAdmin, (req, res) => {
    const { type, id } = req.params as { type: 'body' | 'tv'; id: string };
    const manifest = readManifest();
    const list = type === 'tv' ? manifest.tvs : manifest.bodies;
    const index = list.findIndex(e => e.id === id);
    if (index === -1) {
      return res.status(404).send('Asset not found');
    }
    const [removed] = list.splice(index, 1);
    try {
      fs.unlinkSync(path.join(assetsDir, removed.filename));
    } catch (err) {
      console.warn('Failed to remove asset file', err);
    }
    try {
      writeManifest(manifest);
      console.log('Asset deleted:', removed.filename);
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Failed to update manifest after delete', err);
      res.status(500).send('Delete failed');
    }
  });
} else {
  console.warn('ADMIN_TOKEN not set; admin endpoints disabled');
}

app.get('/api/assets', (_req, res) => {
  res.json(readManifest());
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

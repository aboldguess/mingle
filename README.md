# Mingle Prototype

Mingle is an experimental 3D video meeting environment. Each attendee controls a
first-person avatar whose face displays a live webcam feed.

## Features
- WASD + mouse look movement with the camera pinned to the avatar centre
- Toggleable spectate mode to view the scene from a fixed overhead camera
- Webcam feed mapped onto the front face of the local avatar
- Basic multi-user position synchronisation via Socket.io
- Configurable port via `PORT` environment variable
- Optional HTTPS support for secure contexts (`USE_HTTPS=true`)
- Verbose logs for easy debugging
- Optional `--debug` flag to surface additional diagnostic information
- Responsive navigation bar with profile menu linking to account management pages

## Quick Start

### Linux / Raspberry Pi
```bash
./setup_mingle_env.sh                # install dependencies
./create_mingle_cert.sh             # optional: create self-signed cert
HOST=0.0.0.0 PORT=8080 npm start     # run over HTTP and allow LAN clients
# HTTPS example:
# USE_HTTPS=true PORT=8443 npm start
# Optional: add --debug for verbose console logging
# USE_HTTPS=true PORT=8443 npm start -- --debug
```

### Windows (PowerShell)
```powershell
./setup_mingle_env.ps1               # install dependencies
./create_mingle_cert.ps1             # optional: create self-signed cert
$env:HOST="0.0.0.0"
$env:PORT=8080
npm start                            # run over HTTP and allow LAN clients
# HTTPS example:
# $env:USE_HTTPS="true"
# $env:PORT=8443
# npm start
# Optional: add --debug for verbose console logging
# npm start -- --debug
```

Once running, the server logs every accessible address, e.g.
`http://192.168.1.10:8080`. Open one of these URLs from any device on the same
network. Mobile browsers require HTTPS to access device sensors; generate the
self-signed certificate and start with `USE_HTTPS=true` to enable it.

> The certificate scripts use OpenSSL. Install it beforehand if it is not already available.

### Controls
- `WASD` to move, mouse to look around
- Press `P` to toggle spectate mode

### Troubleshooting
If you see a blue screen with three loading dots, the webcam stream has not
started. Confirm that the browser has permission to use the camera. Launching
the server with the `--debug` flag provides console output that can help
diagnose the problem.

## Development Notes
- Set `PROD=true` when starting the server to log production mode.
- Server and client log connection and debugging information to the terminal
  console.
- The codebase is intentionally small and documented to aid further extension.

## Future Work
This prototype demonstrates the core concept only. Production use will require
advanced networking, authentication, UI/UX improvements, and scalability testing.

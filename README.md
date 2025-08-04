# Mingle Prototype

Mingle is an experimental 3D video meeting environment. Each attendee controls a
first-person avatar whose face displays a live webcam feed.

## Features
- WASD + mouse look movement in a simple 3D scene
- Webcam feed mapped onto the local avatar
- Basic multi-user position synchronisation via Socket.io
- Configurable port via `PORT` environment variable
- Verbose logs for easy debugging
- Optional `--debug` flag to surface additional diagnostic information

## Quick Start

### Linux / Raspberry Pi
```bash
./setup_mingle_env.sh
PORT=8080 npm start
# Optional: add --debug for verbose console logging
# PORT=8080 npm start -- --debug
```

### Windows (PowerShell)
```powershell
./setup_mingle_env.ps1
$env:PORT=8080
npm start
# Optional: add --debug for verbose console logging
# npm start -- --debug
```

Once running, open your browser at `http://localhost:8080` (or the port you
specified). Allow webcam access when prompted.

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

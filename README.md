# Mingle Prototype

Mingle is an experimental 3D video meeting environment. Each attendee controls a
first-person avatar whose face displays a live webcam feed.

## Features
- Start menu offering FPV, Spectator and Lakitu viewing modes
- WASD + mouse look movement with the camera pinned to the avatar centre
- Toggleable spectate mode to view the scene from a fixed overhead camera
- Webcam feed mapped onto the front face of the local avatar
- Peer-to-peer webcam sharing so remote avatars display live video via WebRTC
- Basic multi-user position synchronisation via Socket.io
- Configurable port via `PORT` environment variable
- Configurable host via `LISTEN_HOST` environment variable
- Optional HTTPS support for secure contexts (`USE_HTTPS=true`)
- Verbose logs for easy debugging
- Optional `--debug` flag to surface additional diagnostic information
- Responsive navigation bar with profile menu linking to account management pages
- Randomised spawn positions so newcomers are immediately visible
- On-screen warning when not using HTTPS so webcams and sensors work over LAN
- Live participant count displayed for quick diagnostics
- Default security headers applied via [Helmet](https://helmetjs.github.io/)

## Quick Start

### Linux / Raspberry Pi
```bash
./setup_mingle_env.sh                # install dependencies
./create_mingle_cert.sh             # optional: create self-signed cert
LISTEN_HOST=0.0.0.0 PORT=8080 npm start  # run over HTTP and allow LAN clients
# HTTPS example:
# USE_HTTPS=true PORT=8443 npm start
# Optional: add --debug for verbose console logging
# USE_HTTPS=true PORT=8443 npm start -- --debug
```

### Windows (PowerShell)
> `create_mingle_cert.ps1` requires PowerShell 7+. Launch these commands from a
> `pwsh` session. Install PowerShell 7 with `winget install Microsoft.PowerShell`
> or download it from the Microsoft Store. If PowerShell 7 is unavailable,
> run the `create_mingle_cert.sh` script under WSL instead.
```powershell
./setup_mingle_env.ps1               # install dependencies
./create_mingle_cert.ps1             # optional: create self-signed cert
$env:LISTEN_HOST="0.0.0.0"
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

### HTTPS Requirement
Most browsers block webcams, VR mode and motion sensors when a site is loaded
over plain HTTP from a LAN address. If the page displays "Access this site over
HTTPS to enter VR mode and grant access to the device sensors", create the
self-signed certificate with `create_mingle_cert` and launch the server with
`USE_HTTPS=true`.

The client will display a warning banner whenever it detects an insecure
context. Running the server with HTTPS resolves webcam and sensor issues and
allows all participants to meet in the same world.

 > The Linux certificate script requires OpenSSL. The PowerShell variant uses Windows’ built-in cryptography and needs no additional tools.

### Controls
- Choose FPV, Spectator or Lakitu from the start menu
- `WASD` to move, mouse to look around
- Press `P` to toggle spectate mode (not available in Lakitu mode)

### Troubleshooting
If you see a blue screen with three loading dots, the webcam stream has not
started. Confirm that the browser has permission to use the camera. Launching
the server with the `--debug` flag provides console output that can help
diagnose the problem.

If other users are not visible, check the user count in the sidebar. A value of
1 indicates that no other participants are connected. Ensure all users load the
page via the same HTTPS address and that any firewalls allow the chosen port.

If `create_mingle_cert.ps1` reports that `GetRSAPrivateKey` is missing, the
script is running under Windows PowerShell 5.1. Launch it from a PowerShell 7
(`pwsh`) session or use the `create_mingle_cert.sh` script under WSL.

## Docker Deployment

### Linux / Raspberry Pi
```bash
docker build -t mingle-server .
docker run -p 8080:8080 mingle-server
```

### Windows (PowerShell)
```powershell
docker build -t mingle-server .
docker run -p 8080:8080 mingle-server
```

The container uses the `PORT` environment variable to determine which internal
port to expose. Adjust the `-p` mapping to match any custom value. The server is
started in production mode and logs the accessible URLs on launch.

## Development Notes
- Set `PROD=true` when starting the server to log production mode.
- Server and client log connection and debugging information to the terminal
  console.
- The codebase is intentionally small and documented to aid further extension.

## Future Work
This prototype demonstrates the core concept only. Production use will require
advanced networking, authentication, UI/UX improvements, and scalability testing.

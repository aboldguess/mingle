# Mingle · Where Zoom Meets Doom

Mingle is a video meeting you can walk around in. Everyone is a first-person, telly-headed avatar
with their own webcam as the face on the screen. Wander a networking lobby and talk to whoever you
walk up to, head through the big doors to catch a keynote on a cinema-sized screen, and pelt your
colleagues with (harmless) confetti.

![Keynote in the auditorium](docs/images/keynote.png)

![Confetti in the lobby](docs/images/lobby.png)

## What you can do

- **Walk around like an FPS.** WASD to move, mouse to look, Shift to sprint, Space to jump, V for a third-person view.
- **Your face on a telly.** Your webcam is the picture on your avatar's CRT head. Camera off? You get a cartoon face that blinks and talks.
- **Proximity voice.** People get louder as you approach and fade as you walk away, panned left and right. Walls between the lobby and the auditorium muffle chatter.
- **Keynotes.** Step into the glowing ring on stage and your camera fills the big screen and your mic reaches every seat. Press P to share your screen instead. The audience is hushed while someone presents.
- **Confetti cannon.** Click to fire. Hits splat the target's view and are counted on your HUD.
- **Emotes and chat.** Keys 1 to 6 float an emoji over your head; Enter to chat, and your words appear in a speech bubble too.
- **Real events.** Accounts, teams and roles, scheduled events with invite links and calendar files, guests without accounts, a queue at the door, host mute/remove/end, Free/Pro/Business plans through Stripe.
- **Solo demo.** `/play` drops you in a venue full of friendly bots, no sign-up needed.

## Run it on your computer (Windows, macOS or Linux)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) running. Then, in PowerShell or a terminal:

```powershell
cd C:\code\mingle          # wherever you cloned it
docker compose up --build
```

The first build takes a few minutes. When the log says `Server listening`, open
**http://localhost:3000**:

- **Play the demo** to try the venue on your own with bots.
- **Sign up**, then **Open a venue now** to host a real event. Copy the invite link and open it in a
  second browser window (or an Incognito/InPrivate window) to see two avatars meet.

Stop it with `Ctrl+C`; `docker compose down` removes the containers (your data stays in a Docker volume).

Tips:

- Allow camera and microphone when the browser asks. Click the 3D view to capture the mouse; Esc frees it.
- Browsers only allow cameras on `localhost` or HTTPS. To play with people on other computers, deploy
  Mingle behind HTTPS (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- If port 3000, 5432 or 7880-7882 is already in use, stop the other app or change the left-hand port in `docker-compose.yml`.

## Develop

```bash
cp .env.example .env
docker compose up -d postgres livekit
# The compose LiveKit uses a different dev secret: in .env set
# LIVEKIT_API_SECRET=devsecret-change-me-devsecret-change-me   (or run `livekit-server --dev` instead)
npm install
npm run db:migrate
npm run dev                              # API on :3000, web app with hot reload on :5173
```

Tests: `npm test` (API integration tests need Postgres), `npm run typecheck`, and the two-browser
smoke test `BASE_URL=http://localhost:5173 node e2e/venue.smoke.cjs`.

## Project layout

```
apps/web/src/world   The 3D venue: engine, venue builder, avatars, bots, LiveKit glue, HUD
apps/web/src/pages   Landing page, solo demo, event entry, dashboard, team, billing
apps/server          Fastify API, Postgres schema and migrations, integration tests
deploy/              LiveKit development config
docs/                Architecture, deployment and roadmap
e2e/                 Two-browser smoke test
```

How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What's next: [docs/ROADMAP.md](docs/ROADMAP.md).

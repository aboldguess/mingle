# Mingle architecture

Mingle is a video meeting you walk around in ("Where Zoom Meets Doom"): each attendee is a
first-person avatar in a 3D venue, with their webcam on their avatar's face and proximity voice.
Organisations sign up, schedule events (stored as meetings), share links, and pay per host through
Stripe. This document explains how the pieces fit.

```
 Browser (React SPA)                     Mingle API (Fastify, Node 22)           Postgres
 ┌─────────────────────┐  HTTPS/JSON    ┌───────────────────────────────┐  SQL   ┌──────────┐
 │ dashboard, team,    │ ─────────────▶ │ auth, orgs, meetings, billing │ ─────▶ │ users,   │
 │ billing, meeting UI │  cookie session│ issues LiveKit join tokens    │        │ orgs,    │
 └─────────┬───────────┘                │ enforces plan limits          │        │ meetings │
           │ WebRTC (DTLS-SRTP)         └──────┬──────────────┬─────────┘        └──────────┘
           │ + signalling (WSS)                │ server API   │ webhooks
           ▼                                   ▼              ▲
 ┌─────────────────────┐               ┌──────────────┐  ┌────┴─────┐
 │ LiveKit SFU         │ ◀──────────── │ RoomService  │  │ Stripe   │
 │ (Cloud or self-host)│ ─ webhooks ─▶ │ (mute/kick)  │  │ Checkout │
 └─────────────────────┘               └──────────────┘  └──────────┘
```

## Why this stack

| Concern | Choice | Reason |
| --- | --- | --- |
| Media | [LiveKit](https://livekit.io) SFU | Open source (Apache 2.0), production proven, simulcast and adaptive streams, screen share, data channels for chat, E2EE support, horizontal scaling. Runs as LiveKit Cloud or self-hosted with no code changes. The old peer-to-peer mesh could not scale past about 5 people. |
| API | Fastify + TypeScript | Fast, schema-friendly, small surface. One process serves the API and the built SPA. |
| Data | Postgres + Drizzle ORM | Relational data with real constraints; Drizzle is pure TypeScript (no native engine) and generates plain SQL migrations committed to `apps/server/drizzle`. |
| Web | React + Vite + three.js | The venue is plain three.js built from primitives and canvas textures (no asset files). React draws the HUD around it. `@livekit/components-react` is used only for the device check before entry and the host's people list. |
| Billing | Stripe Checkout + Billing Portal + webhooks | No card data touches our servers (PCI SAQ-A). Plans change only via signed, idempotent webhooks. |

## The 3D venue (apps/web/src/world)

| File | Role |
| --- | --- |
| `venue.ts` | Builds the lobby, auditorium, stage and big screen; exposes the collision boxes and `zoneAt()` (lobby, auditorium or stage). |
| `avatar.ts` | Telly-headed avatar: body, walk animation, CRT screen that shows a `VideoTexture` of the webcam or a cartoon face, name tag, emote and chat bubbles, speaking light. |
| `engine.ts` | `World`: renderer, game loop, pointer-lock FPS controls with step-up/jump/collision, remote interpolation, confetti projectiles and particles, big-screen texture, minimap. Network agnostic. |
| `session.ts` | `WorldSession`: glue to a LiveKit `Room`. Sends and receives state over data messages, maps tracks to faces and the big screen, mixes voices. |
| `bots.ts` | Pretend attendees (with tags, goals, looks and gestures) and a keynote slide deck for the solo demo and the landing page backdrop. |
| `whiteboard.ts` | Pod whiteboard strokes: validation and painting onto the boards' canvas textures. |
| `match.ts` | Matchmaking: keyword overlap between "Here to…" goals and "Ask me about…" tags. |
| `captions.ts` | Live captions of your own speech with the browser's speech recognition. |
| `panels.tsx` | People panel (host tools, groups, branding, matches), business cards and the whiteboard editor. |
| `WorldView.tsx` | React HUD: self view, meeting controls, emotes, chat, minimap, tips, front-row view, More menu, help card. |

Networking uses LiveKit only; there is no separate game server.

- **Movement**: each client publishes `{x, y, z, yaw, pitch, colour}` on the `mingle` data topic, lossy, up to ~12 times a second while moving and once a second when idle. Receivers interpolate. Everything a client receives is validated before use.
- **Events**: emotes (allow-listed emoji), confetti shots (origin + direction, every client simulates the same arc), hits (sent by the shooter), chat, captions, gestures, profiles (tag, goal, contact, avatar look), business cards, raised hands and whiteboard strokes go over the same topic, reliably. Host-only messages (mic holder, summon, announcement, discussion groups, branding) are ignored unless the sender's token metadata marks them as host. Each client re-sends its profile, hand, strokes and (if host) mic holder and branding when someone joins or it reconnects.
- **Voice levelling**: each remote microphone runs through a `DynamicsCompressorNode` and make-up gain before its panner, so quiet voices are lifted and loud ones tamed.
- **Pods**: anyone inside a pod is silent to everyone outside it, and vice versa.
- **Proximity voice**: remote microphones are routed through one shared `AudioContext` (the room's `webAudioMix`), with a `StereoPannerNode` per speaker. Every 120 ms volume is set from distance (full under 2.5 m, silent beyond ~16 m), cut to 30% through the lobby/auditorium wall. Someone on stage is heard at full volume across the auditorium, and the audience is halved while they present.
- **Bandwidth**: adaptive stream is off; instead each remote camera's simulcast layer is chosen by distance (high under 6 m, medium under 14 m, low beyond, paused beyond 32 m). Presenters always get high.
- **Big screen**: a screen share wins; otherwise the camera of whoever stands on stage; otherwise the idle card. Screen sharing is offered only on stage.

## Repository layout

```
apps/server     Fastify API (src/), SQL migrations (drizzle/), integration tests (test/)
apps/web        React SPA (src/), the 3D venue (src/world/), unit tests (test/)
deploy/         LiveKit config for local development
docs/           Architecture, deployment, roadmap
```

## Domain model

- **User**: email + scrypt password hash. Sessions are random 256-bit tokens; only their SHA-256 is stored.
- **Organization**: the billing unit. Has a `plan`, Stripe ids and `subscriptionStatus`.
- **Membership**: user ↔ org with role `owner | admin | member`. Every org keeps at least one owner.
- **Invitation**: emailed (or copied) link with a single-use hashed token, 7 day expiry, bound to the invitee's email.
- **Meeting**: belongs to an org, has a host and a public code like `kdu-xmpq-wza` (~47 bits of entropy). The LiveKit room is `mingle-<code>`.
- **AdmissionRequest**: a guest waiting in a meeting's waiting room.
- **AuditLog**: security and admin events (sign-ins, role changes, invitations, billing, meeting moderation).

## Event entry flow

1. The browser loads `/m/<code>` and fetches public meeting info.
2. The user picks camera/mic in the pre-join screen and calls `POST /api/meetings/<code>/join`.
3. The API checks: meeting not cancelled; guest policy (meeting `allowGuests`, org `membersOnlyMeetings`); waiting room; plan time limit.
4. It creates the LiveKit room with the plan's `maxParticipants`, marks the meeting live and returns a short-lived JWT.
   Hosts (meeting creator, org owners and admins) get `roomAdmin`.
5. The browser connects straight to LiveKit with the token. Media never passes through the API.
6. Host actions (mute, remove, end) go through the API, which checks the role and calls LiveKit's server API, then writes an audit entry.
7. A 30 second sweeper ends meetings that exceed their plan's length, and LiveKit's `room_finished` webhook marks empty meetings as ended.

## Plans and limits

Defined in `apps/server/src/plans.ts` and enforced on the server:

| | Free | Pro | Business |
| --- | --- | --- | --- |
| Meeting length | 40 min | 30 h | 30 h |
| Participants per meeting | 100 | 100 | 300 |
| Members per org | 3 | 50 | 1000 |

Paid features stay on while the subscription is `active`, `trialing` or `past_due` (Stripe's retry window). Anything else falls back to Free.

## Security

- Passwords: scrypt (N=2^17, r=8, p=1), constant-time compare, equalised timing for unknown emails.
- Sessions: `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS cookies; server-side revocation on logout.
- CSRF: SameSite cookies plus an Origin check on every state-changing request.
- Rate limits on sign-up/login (per IP) and meeting joins.
- Strict CSP, `frame-ancestors 'none'`, HSTS and other headers via Helmet.
- Media is always encrypted in transit (DTLS-SRTP). Join tokens are scoped to one room and expire.
- Stripe and LiveKit webhooks are signature-verified; Stripe events are processed idempotently.
- Inputs are validated with Zod; all SQL goes through parameterised queries.
- Audit log for sign-ins, failures, membership, invitations, billing and moderation.

See `docs/ROADMAP.md` for SSO, recording, E2EE toggle and other enterprise features still to come.

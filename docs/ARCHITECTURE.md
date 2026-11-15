# Mingle architecture

Mingle is a hosted video meeting product: organisations sign up, schedule meetings, share
links, and pay per host through Stripe. This document explains how the pieces fit.

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
| Web | React + Vite + `@livekit/components-react` | The LiveKit components give a polished conference UI (grid and speaker layouts, device pickers, chat, screen share) that we wrap with Mingle's own host controls. |
| Billing | Stripe Checkout + Billing Portal + webhooks | No card data touches our servers (PCI SAQ-A). Plans change only via signed, idempotent webhooks. |

## Repository layout

```
apps/server     Fastify API (src/), SQL migrations (drizzle/), integration tests (test/)
apps/web        React SPA (src/), unit tests (test/)
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

## Meeting join flow

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

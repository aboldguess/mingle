# Roadmap

Delivered in incremental pull requests. Each phase is shippable.

## Phase 1: Accounts, teams and billing (done)
- Accounts, organisations, roles (owner/admin/member), invitations
- Scheduled and instant meetings with shareable links and calendar (.ics) invites
- Multi-party video and audio over LiveKit, screen share, in-meeting chat
- Guest join, waiting room, mute on entry, host mute/remove/end for all
- Free / Pro / Business plans with server-enforced limits
- Stripe Checkout, Customer Portal and webhooks
- Audit log, security headers, rate limits, CSRF protection
- Docker, docker compose, GitHub Actions CI, architecture and deployment docs

## Phase 1.5: The venue (done)
- First-person 3D venue with a networking lobby and an auditorium with a stage and big screen
- Telly-headed avatars with webcam faces, emotes, chat bubbles and a confetti cannon
- Proximity voice with stereo panning, stage mic, distance-based video quality
- Solo demo with bots at `/play`, landing page rebuilt around "Where Zoom Meets Doom"

## Next for the venue
- More venues to pick per event (rooftop bar, expo hall with sponsor booths, breakout pods)
- Sit in seats, a Q&A mic in the aisle, hand raise
- Touch controls for phones and tablets
- Custom avatar bodies and telly styles, team-branded venues
- Spectator count and replay of keynotes (LiveKit Egress)

## Phase 2: Launch hardening
- Transactional email (invitations, meeting invites, password reset, email verification) via a pluggable provider (Resend/SES/Postmark)
- Password reset and email verification flows
- Playwright end-to-end tests in CI against a LiveKit dev server
- Error tracking (Sentry) and metrics (OpenTelemetry), uptime checks
- Terms of service, privacy policy and cookie notice pages
- Super-admin console for the platform operator (orgs, usage, impersonation with audit)

## Phase 3: Enterprise
- SSO: SAML 2.0 and OIDC per organisation (Okta, Entra ID, Google Workspace), domain verification, enforced SSO
- SCIM user provisioning
- End-to-end encryption toggle per meeting (LiveKit E2EE with per-meeting keys)
- Cloud recording and transcripts via LiveKit Egress to S3-compatible storage, with retention policies
- Data residency (region-pinned LiveKit and database)
- Two-factor authentication (TOTP, passkeys)
- SOC 2 groundwork: access reviews, change management, logging retention

## Phase 4: Product depth
- Recurring meetings and Google/Outlook calendar integrations
- Personal meeting rooms, meeting passcodes
- Polls and live Q&A on the big screen
- Background blur and noise suppression (LiveKit track processors)
- Webinars (view-only attendees, large audiences via LiveKit's broadcast mode)
- Persistent team chat and meeting notes
- Usage analytics dashboard for admins
- Mobile apps (React Native with LiveKit SDK)

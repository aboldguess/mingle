# Deploying Mingle

Mingle needs three things in production:

1. **The Mingle app**: one Docker image (API + web app), stateless, scale horizontally.
2. **Postgres 14+**: any managed Postgres (AWS RDS, Google Cloud SQL, Neon, Supabase, Render, Railway...).
3. **A LiveKit media server**: LiveKit Cloud or self-hosted.

## 1. Choose how to host video

| Option | Good for | Notes |
| --- | --- | --- |
| **LiveKit Cloud** (recommended to launch) | Going live this week | Create a project at cloud.livekit.io and copy its URL, API key and secret. Pay as you go per participant-minute, global edge network, nothing to operate. |
| **Self-hosted LiveKit** | Lower cost at scale, data residency | Run `livekit-server` on VMs with public IPs (UDP 50000-60000, TCP 7881, 443 via TLS). Follow LiveKit's deployment guide (it generates a config with Caddy for TLS and an embedded TURN server). Use Redis to run several nodes. |

Switching later is only a change of the three `LIVEKIT_*` variables.

In the LiveKit project, add a webhook pointing at `https://<your-domain>/api/webhooks/livekit`
so meetings are marked ended when everyone leaves.

## 2. Set up Stripe

1. Create a Stripe account and stay in **test mode** first.
2. Create two products, **Pro** and **Business**, each with a recurring monthly price **per unit**
   (Mingle bills one unit per organisation member). Copy the two `price_...` ids.
3. Turn on the **Customer portal** (Settings → Billing → Customer portal) and allow plan switching between the two prices, cancellation and invoice history.
4. Add a webhook endpoint `https://<your-domain>/api/webhooks/stripe` for these events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its signing secret (`whsec_...`).
5. Turn on Stripe Tax if you need VAT/sales tax, and set up your statement descriptor and branding.

When ready to charge real money, repeat with live-mode keys.

## 3. Configure the app

| Variable | Required | Example |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/mingle?sslmode=require` |
| `APP_URL` | yes | `https://meet.example.com` (exact public origin, used for links and CSRF checks) |
| `LIVEKIT_URL` | yes | `wss://myproject.livekit.cloud` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | yes | from LiveKit |
| `LIVEKIT_API_URL` | no | internal `http(s)://` URL for LiveKit's server API if it differs from `LIVEKIT_URL` |
| `STRIPE_SECRET_KEY` | for billing | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | for billing | `whsec_...` |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS` | for billing | `price_...` |
| `TRUST_PROXY` | behind a load balancer | `true` |
| `PORT` | no | `3000` |
| `MIGRATE_ON_START` | no | `true` (default) runs SQL migrations at boot |
| `AUTH_RATE_LIMIT_PER_MIN` | no | `10` |
| `LOG_LEVEL` | no | `info` |

Keep secrets in your platform's secret manager, never in git.

## 4. Run it

Any container platform works (Render, Railway, Fly.io, AWS ECS/App Runner, Google Cloud Run, Azure Container Apps, Kubernetes):

```bash
docker build -t mingle .
docker run -p 3000:3000 --env-file .env.production mingle
```

- Health checks: `GET /healthz` (process up) and `GET /readyz` (database reachable).
- Put it behind HTTPS (cameras and microphones only work on secure origins).
- Logs are structured JSON on stdout; cookies and auth headers are redacted.
- Run at least two instances for availability. The meeting-limit sweeper is safe to run on all of them.
- Back up Postgres daily (managed providers do this) and test a restore.

## Local development

```bash
cp .env.example .env
npm install
# Postgres: docker compose up -d postgres   (or a local install)
# LiveKit:  livekit-server --dev             (key devkey, secret "secret")
npm run db:migrate -w apps/server
npm run dev            # API on :3000, web on :5173 (proxies /api)
```

Or run the whole stack in containers with `docker compose up --build` and open http://localhost:3000.

### Tests

```bash
createdb mingle_test   # once
npm test               # server integration tests (real Postgres) + web unit tests
```

CI (GitHub Actions) runs typecheck, tests, build, a migration drift check, a dependency audit and a Docker build on every PR.

### End-to-end smoke test

With `livekit-server --dev` and the app running on port 3000 (built web app served via `WEB_DIST_DIR`),
`node e2e/meeting.smoke.cjs` drives two Chromium browsers with fake cameras through sign-up, starting
a meeting, a guest joining from the link, chat, and the host removing the guest. Requires Playwright.

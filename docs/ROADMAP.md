# Mingle roadmap

Mingle is a networking event you walk around in: a first-person venue where everyone is a
telly-headed avatar with their own webcam as the face. **Where Zoom Meets Doom.** It is not a Zoom
clone, and every chunk below is judged by one question: does it make the in-world experience more
valuable, more fun, or more likely to bring people back?

This roadmap goes back to the original Talking Heads proposal (Boondoggle, Innovate UK Smart Grant
101231, 2020), takes stock of what is built, and lays out the work in chunks that can each ship on
their own. It is written to get Mingle **production ready and earning early**, with reasons for
people to keep coming back over weeks and months.

- [1. What the original proposal promised](#1-what-the-original-proposal-promised)
- [2. Where we are](#2-where-we-are)
- [3. Who we sell to first](#3-who-we-sell-to-first)
- [4. Measurable value: the numbers we prove](#4-measurable-value-the-numbers-we-prove)
- [5. Why people come back](#5-why-people-come-back)
- [6. How Mingle makes money](#6-how-mingle-makes-money)
- [7. The chunks](#7-the-chunks)
- [8. Milestones and order](#8-milestones-and-order)
- [9. Risks](#9-risks)
- [10. Decisions for Phil](#10-decisions-for-phil)
- [Appendix: delivered so far](#appendix-delivered-so-far)

---

## 1. What the original proposal promised

The 2020 proposal set out a mission: let professionals communicate online *more* effectively than
face to face, using video-game technology. Its promises, and how far Mingle has got:

| Proposal promise | Status |
| --- | --- |
| Avatars with a TV for a head showing the live webcam | Done |
| Walk around a 3D venue; many conversations in one "call" | Done |
| Spatial, stereo-panned voice so you know who spoke | Done |
| Equal voices: levelling so quiet speakers are heard (EDI goal) | Levelling done; AI clarity not started |
| Gestures and postures (lean in, nod) | Done (keys 7 to 0) |
| Discussion groups in one call; facilitators visit tables | Done |
| "Objectives" thought bubbles, expertise colour coding | Name tags done; colour coding not started |
| Matchmaking abilities against requirements, auto-manoeuvring | Keyword matching done; AI and LinkedIn not started |
| Whiteboards and slide areas | Whiteboards done; slide upload in progress (chunk 0) |
| Live transcripts over heads, translation | Own-speech captions (Chrome/Edge) done; translation not started |
| UI that mirrors Zoom/Skype but keeps a unique feel | Done (bottom bar, first-run tips) |
| Tailored tools for organisers, venue owners, attendees | Organiser tools started; venue owners not started |
| Avatar customisation sold as microtransactions | Free customisation done; no shop |
| Licensed virtual copies of real venues, many instances at once | Not started |
| Per-viewer, trackable advertising in the venue | Static sponsor signage only |
| LinkedIn/Slack profile linking | Not started |
| Reliable, consistent, secure, robust, resilient sessions | Good base (LiveKit, reconnect); not load tested |
| Training material, customer demo, costing structures | `/play` demo done; rest not started |
| Target: 20 to 500 delegate events | Capped at 100 (300 on Business); untested at size |

The proposal's revenue ideas (subscriptions, microtransactions, venue licensing, in-world
advertising) still stand and appear in section 6, with two additions it did not have: per-event
passes and ticketing.

## 2. Where we are

**Built and working:** the venue (lobby, auditorium, stage, big screen, pods), proximity voice with
panning and levelling, telly avatars with gestures, emotes and customisation, host tools (groups,
call everyone in, announcements, pass the mic, door queue, mute/remove), business cards with vCard
export, keyword matchmaking, captions, whiteboards, branding, a bot-filled demo at `/play`, plus the
account, organisation, LiveKit and Stripe plumbing.

**What stops us charging real customers today:**

1. **Nothing about a person survives an event.** Profiles, avatar look, tags and collected business
   cards live in the browser's local storage. Change laptop and it is all gone. There is no
   "people I met" history, so there is nothing to come back to.
2. **We cannot show the value.** No event analytics, no product analytics. An organiser cannot see
   how many conversations happened or who met whom, and we cannot see where people drop off.
3. **Pricing is Zoom-shaped.** Plans charge per host seat and cut free events off at 40 minutes. An
   event organiser thinks in events and attendees, and being cut off mid-keynote is the opposite of
   fun.
4. **No production basics.** No transactional email (so no password reset, verification or
   reminders), no file storage (needed for slides), no error tracking, no legal pages, no load test,
   no way to report or block someone.
5. **Events are still "meetings"** in the API, with no registration, agenda, speakers or sponsors.

The chunks in section 7 fix these in order of how much they block revenue.

## 3. Who we sell to first

The proposal named 20 to 500 delegate events. Start narrower, where a 3D venue beats a grid of faces
most clearly and the buyer can say yes quickly:

1. **Professional and community networking events** (meetups, associations, alumni groups,
   accelerators, chambers of commerce). The whole point is meeting people, which is exactly what
   Zoom is bad at. Phil's Cambridge network (university, venues, co-working spaces) is the pilot
   pool.
2. **Remote and hybrid company socials and all-hands.** Recurring by nature (monthly socials,
   quarterly all-hands), so they drive retention, and the budget holder pays annually.
3. **Small conferences** (a keynote plus networking, under 300 people). Bigger and more lucrative,
   but they need ticketing, sponsors and reliability at scale, so they come after the first two.

Teaching, dating and gaming communities are tempting but pull the product in different directions;
park them.

## 4. Measurable value: the numbers we prove

Mingle sells *connections*, so it should count them. These come from chunk 3 (measurement).

**North star: meaningful conversations per attendee.** A meaningful conversation is two people
within talking distance (about 2.5 m, same pod or zone) with at least one of them speaking, for 60
seconds or more. It is measurable from positions and speaking state the clients already have.

Supporting numbers, each shown to organisers in their post-event report:

| Number | What it shows |
| --- | --- |
| Meaningful conversations per attendee, and unique people met | Did people actually network? |
| Matches acted on (nudge followed, then a conversation) | Did matchmaking work? |
| Business cards swapped, follow-ups sent within 7 days | Did connections stick? |
| Time in event, time at talks, drop-off curve | Was it engaging? |
| Sponsor booth visits, dwell time, consented leads | Did sponsors get value? |
| Post-event rating (one tap, "worth your time?") | Did people like it? |

Business numbers we watch ourselves: organiser repeat rate (second event within 60 days), attendee
return rate (another Mingle event within 60 days), free-to-paid conversion, revenue per event, and
media cost per attendee-hour (so every price keeps a healthy margin).

Starting targets to test against in the pilot, not promises: at least 5 meaningful conversations per
attendee per hour of networking; at least half of pilot organisers running a second event; at least
a quarter of attendees returning within 60 days.

## 5. Why people come back

Retention has to come from value and delight, never from chores (no daily streaks, no
log-in-to-claim rewards, no nagging). Three groups, three loops.

### Attendees: "Mingle remembers who I met"

- **Mingle Passport.** One profile that travels with you to every event: avatar look, telly, outfit,
  "Ask me about", "Here to", contact details, optional LinkedIn. Set it once, look like yourself
  everywhere.
- **Connections book.** Everyone you had a meaningful conversation with or swapped cards with, with
  where and when you met, a photo of their telly, and a private note. This is the thing Zoom can
  never give you, and it gets more valuable with every event.
- **Post-event recap** (email and in-app, the morning after): "You met 7 people, 3 matched what you
  were here for." One click to follow up, connect on LinkedIn, or save to contacts.
- **"People you met are going"**: a gentle note when someone in your connections book registers for
  an upcoming event.
- **Event souvenirs.** Each event can give attendees a collectible pin or lanyard to wear on their
  avatar. Your avatar quietly shows where you have been, which is a conversation starter and a
  reason to turn up. Purely cosmetic.
- **Kudos.** After a conversation you can thank someone ("helpful", "great chat"). Counts show on
  their Passport. Positive only, no ratings or downvotes.

### Organisers: "My community lives here"

- **Spaces.** A community's permanent home venue with its own branding, members list and recurring
  series (for example "First Thursday Founders Drinks"). Members follow the Space and get invited to
  each one.
- **Post-event report** with the numbers in section 4, exportable as a PDF for their boss or
  sponsors. This is the proof that renews subscriptions.
- **Event templates and run-of-show** so the second event takes five minutes to set up.
- **Attendee list that grows**: everyone who attended, with consent, for future invitations.

### Sponsors: "I can see what I got"

- Booth visits, dwell time and consented leads, delivered as a report. Sponsors who see results come
  back next quarter and pay organisers more, who then need a paid plan.

## 6. How Mingle makes money

### Ground rules (keep it fun)

1. **Attendees never pay to take part.** Joining, walking, talking and networking are always free.
2. **Organisers pay for scale and results**, not for time. Never cut an event off mid-talk.
3. **Cosmetics only.** Anything sold to attendees is looks and fun. Nobody can pay for more
   visibility, louder voice or better placement in matchmaking.
4. **No ads during talks or private conversations.** Sponsor content lives in the lobby, expo hall
   and signage, chosen by the organiser.
5. **Upgrade prompts at natural moments** (creating an event bigger than the plan allows, wanting a
   report), never during an event.

### Revenue streams, in the order to build them

| # | Stream | Who pays | Shape (suggested starting prices, to test) | Chunk |
| --- | --- | --- | --- | --- |
| 1 | **Organiser plans** | Organisers | Free: up to 25 attendees, unlimited length, "Made with Mingle" signage. Host £29/month: 100 attendees, slides, branding, basic report. Pro £99/month: 300 attendees, sponsors, full analytics, CSV/CRM export, co-hosts, recordings. Enterprise: custom, from about £5k/year, 500+ attendees, SSO, data residency, SLA. Two months free on annual. | 4 |
| 2 | **Event passes** | Occasional organisers | One-off, no subscription: £49 up to 100 attendees, £149 up to 300, £299 up to 500. Easiest first sale for the pilot. | 4 |
| 3 | **Ticketing fee** | Organisers selling tickets | Stripe Connect: 2.5% per paid ticket on Free and Host, 1% on Pro, nothing on free tickets. | 8 |
| 4 | **Sponsor packages** | Sponsors, via organisers | Booths, signage and a lead report. Organiser sets the sponsor price; Mingle charges a flat sponsor add-on (about £99 per sponsor per event) or a share on Free and Host plans. | 7 |
| 5 | **Cosmetics shop** | Attendees who want to | Telly styles, outfits, props, emotes, confetti styles. £1 to £5 per item, seasonal drops. | 9 |
| 6 | **Mingle Plus** | Keen attendees | £3.99/month: a monthly cosmetic, custom name-tag styles, unlimited connections-book history and notes, follow-up reminders. Free users keep the last 3 events. | 9 |
| 7 | **Virtual swag** | Organisers and sponsors | Branded t-shirt, lanyard or mug given to every attendee, about £0.50 per attendee. Fun, and free advertising for the sponsor. | 9 |
| 8 | **Venue packs and custom venues** | Organisers, companies | Extra themed venues (rooftop bar, expo hall, campus) included in Pro. Custom branded venues as a service, £2k to £15k. | 10 |
| 9 | **Real-venue licensing** | Physical venues | Virtual copy of a real venue (photogrammetry), which the venue rents out as many simultaneous instances. Build fee plus revenue share. | 10 |
| 10 | **AI credits** | Organisers | Captions for every browser, translation, AI recaps and keynote summaries. Some included per plan, more metered. | 11 |

The biggest early earners will be 1, 2 and 4. Cosmetics and Plus grow with the user base; venue
licensing is a longer sales cycle but a strong story for the Cambridge venues.

**Costs to watch.** The main variable cost is LiveKit media (charged per participant-minute on
LiveKit Cloud, or servers if self-hosted). Chunk 3 measures our real cost per attendee-hour and
every price above should be checked against it before launch. Moving to self-hosted LiveKit once
volume justifies it is a config change (see DEPLOYMENT.md).

## 7. The chunks

Each chunk ships on its own and is sized in pull requests of roughly the size Mingle has been
built in so far (S = 1 to 2, M = 3 to 5, L = 6 or more). Chunks with the same milestone can run in
parallel.

### Chunk 0: Make it feel right (in progress)

Fixes and features Phil asked for on 2026-11-17, being built in a separate thread now.

- Telly heads tilt the correct way: looking up shows the head tilting up to others (pitch is
  currently inverted for remote viewers).
- Head turns independently of the body: small mouse movements turn only the head; the body catches
  up when the head turns past a comfortable angle. Lets people shake their heads and turn to face
  each other in a group naturally.
- Upload slides to the big screen: PDF first (rendered in the browser with pdf.js, next/previous
  from the stage, everyone sees the same page). PowerPoint next, converted to PDF on the server
  with LibreOffice so layout and images survive; animations and embedded video do not, and screen
  share remains the way to show a fully live deck.
- The "stand here" spot on the stage moves to the podium.
- Host controls for the auditorium: mute everyone in the hall, and an optional presenters list so
  only named people can step onto the stage.
- Pre-join set-up: frame your webcam (zoom and position) so your face fills the telly at the right
  size, and customise your avatar with a live, slowly rotating preview that waves now and then.

**Done when:** all six work in a two-browser test and Phil signs off. *Size: M.*

### Chunk 1: Production foundations

Everything a paying customer assumes is there.

- **Hosting**: one region (UK/EU) on a managed platform (for example Fly.io or Render for the app,
  Neon or a managed Postgres, LiveKit Cloud), custom domain and HTTPS, staging plus production,
  deploy on merge, nightly database backups with a tested restore.
- **Object storage** (S3 or Cloudflare R2) for slides, logos and later recordings, with size and type
  checks and virus scanning of uploads.
- **Transactional email** (Postmark, Resend or SES): verification, password reset, invitations,
  event reminders. Unsubscribe and preferences from day one.
- **Observability**: Sentry for errors in the browser and server, uptime checks, a status page,
  LiveKit webhooks into logs.
- **Load test**: 100 then 300 headless bot clients in one venue, measuring frame rate, bandwidth and
  CPU on a mid-range laptop. Fix the worst offenders (for example only subscribing to video within a
  radius, lower texture sizes, a "low power" mode).
- **Browser support**: Chrome, Edge, Safari and Firefox on desktop, with a friendly message on
  unsupported devices and a WebGL fallback screen.
- **Trust and safety**: report and block a person, host ban for the event, word filter on names,
  tags and chat, an abuse inbox, and a code of conduct shown on entry.
- **Legal**: terms of service, privacy policy, cookie notice, a data processing agreement for
  business customers, and records of processing (UK GDPR). Proximity and conversation data counts
  as personal data, so the privacy policy must cover chunk 3 before it ships.

**Done when:** a stranger can sign up, reset a password, host a 100-person event on the production
domain, and we hear about any error before they tell us. *Size: L.*

### Chunk 2: Mingle Passport and real events

Give people an identity that persists, and give events a proper shape.

- Server-side **profile**: avatar look, telly, outfit, height and build, "Ask me about", "Here to",
  contact details, optional photo, pronouns. Migrate the local storage profile on first sign-in.
- Guests can still join without an account; at the end they are offered "Keep the people you met:
  save your Passport" (one-click magic-link email).
- **Connections** stored on the server: business cards swapped, with consent on both sides; private
  notes.
- **Events, not meetings**: rename the model, add title, description, cover image, start and end
  times, time zone, capacity, and a public event page with registration (name, email, a couple of
  organiser questions).
- **Roles in an event**: organiser, co-host, speaker, sponsor staff, attendee. Speakers and the
  presenters list from chunk 0 use this.

**Done when:** a person can attend two events on two computers and see the same avatar and the same
connections, and an organiser can publish an event page people register on. *Size: L.*

### Chunk 3: Measure everything that matters

The numbers in section 4, for organisers and for us.

- Clients report **interaction events** in small batches: conversation started/ended (pair, zone,
  duration), match nudge shown/followed, card swapped, zone entered/left, talk watched, gesture and
  emote counts. The server rolls them up per event. Raw position trails are not stored.
- **Organiser dashboard and post-event report**: attendance, the drop-off curve, meaningful
  conversations, people met per attendee, matches acted on, cards swapped, talk attendance, ratings,
  a heatmap of where people gathered. PDF export.
- **One-tap rating** at leave: "Was this worth your time?" plus optional comment.
- **Product analytics** (PostHog, EU hosted or self-hosted) for funnels: landing, demo, sign-up,
  first event, second event, upgrade. Cookie consent respected.
- **Cost meter**: media minutes per event from LiveKit webhooks, giving cost per attendee-hour.

**Done when:** after a pilot event the organiser receives a report they would forward to their boss,
and we can see our conversion funnel and margin. *Size: M.*

### Chunk 4: Start charging (monetisation v1)

- Replace the per-seat plans in `apps/server/src/plans.ts` with **event-shaped plans** (attendee cap
  per event, features per plan) and remove the 40-minute cut-off. Caps are enforced at registration
  and entry, never by ending a live event; going over by a few people is allowed with a polite note
  to the organiser afterwards.
- **Event passes** as one-off Stripe Checkout payments attached to a single event.
- **Free trial of Pro for an organiser's first event**, so their first report shows everything.
- Pricing page, upgrade prompts at natural moments, invoices and VAT through Stripe Tax, annual
  billing, coupons for pilots.
- "Made with Mingle" signage in free events (a tasteful sign in the lobby that links to Mingle).

**Done when:** a pilot organiser can pay for an event pass or a plan without talking to us, and
the limits match the pricing page. *Size: M.*

### Chunk 5: Events organisers love to run

- **Agenda**: sessions with times (doors open, keynote, networking, panels). The venue follows it:
  doors open on time, a gentle "keynote starts in 5 minutes" with a "take me there" button, the
  big screen shows what is next.
- **Green room** behind the stage for speakers to check camera, mic and slides before going on.
- **Slide library** per event, with the speaker's deck queued on the big screen when they step up.
- **Polls and live Q&A** on the big screen, with upvotes.
- **Branding**: logo, colours, sponsor signage, custom welcome message, all previewed before the
  event.
- **Templates** ("networking evening", "meetup with a talk", "company social", "mini conference")
  and **duplicate event**.
- **Reminders**: email with calendar file on registration, a day before and 15 minutes before.
- **Help for hosts**: a 2-minute guided tour for first-time organisers and a short video for each
  host tool (the proposal's training materials).

**Done when:** an organiser can set up a repeat of their last event in under five minutes and run
it without us on the call. *Size: L.*

### Chunk 6: Reasons to come back (retention loops)

- **Connections book** page and in-world panel, with search, notes and "met at".
- **Post-event recap** email and page the morning after, with one-click follow-ups.
- **Kudos** after conversations.
- **Event souvenirs**: organiser-chosen pin or lanyard collected by attendees, worn on the avatar.
- **Spaces**: a community's permanent branded venue, member list, follow button, recurring series,
  "open hours" where the venue stays open between events.
- **"People you met are going"** notifications, with an easy weekly digest setting and no daily
  nags.

**Done when:** pilot data shows attendees opening recaps and returning to a second event; target a
quarter of attendees back within 60 days. *Size: L.*

### Chunk 7: Sponsors and the expo hall

- **Expo hall venue** with booths: sponsor logo, booth screen (video or slides), staff spawn at their
  booth, a "visit booth" teleport.
- **Lead capture with consent**: an attendee taps "share my card with this sponsor"; nothing is
  shared silently.
- **Sponsor report**: booth visits, dwell time, conversations with staff, leads.
- **Sponsor tiers** for organisers to sell (headline, gold, booth only) and lobby signage
  placements. Later: per-viewer placements (the proposal's idea) chosen by attendee interests,
  never in talks.

**Done when:** a pilot sponsor gets a report of leads they would pay for again. *Size: M.*

### Chunk 8: Ticketing

- Stripe Connect onboarding for organisers, ticket types (free, paid, early bird, VIP), promo codes,
  refunds, payouts, receipts. Mingle's fee as in section 6.
- Ticket-holder roles (for example VIP lounge access in the venue).
- Import attendees from Eventbrite, Luma or Meetup for organisers who already sell elsewhere.

**Done when:** an organiser sells tickets to a paid event and gets paid out. *Size: M.*

### Chunk 9: Shop, Mingle Plus and virtual swag

- **Item catalogue and inventory** (telly styles, outfits, props, emotes, confetti), owned items on
  the Passport, Stripe one-off payments, gifting.
- **Mingle Plus** subscription for attendees.
- **Virtual swag**: an organiser or sponsor buys a branded item for every attendee.
- **Seasonal drops** (festive jumper in December, as the proposal suggested).
- Items stay cosmetic and subtle: nothing that blocks a view, makes noise in talks or affects
  matchmaking.

**Done when:** the shop is live with 30 or more items and swag has been sold to at least one pilot
sponsor. *Size: M.*

### Chunk 10: More venues, and real venues

- **Venue packs**: rooftop bar (relaxed networking), expo hall (chunk 7), campus quad, boardroom for
  small groups. Each must stay calm and content-first.
- **Venue picker** per event and per Space.
- **Asset pipeline**: import glTF/GLB models for venues and items (the original prototype's
  admin uploader on old `codex/` branches is a starting point), with size budgets so venues load fast.
- **Real-venue pilot**: one Cambridge venue captured with photogrammetry, cleaned up, licensed back
  to the venue to rent out as virtual instances, with a revenue share.

**Done when:** organisers can pick from at least three venues and one real venue is live. *Size: L.*

### Chunk 11: The AI layer

- **Captions for everyone** using server speech-to-text (any browser), shown over heads as the
  proposal described, and **translation** of captions into each listener's language.
- **AI matchmaking**: profile and LinkedIn embeddings instead of keywords; "Introduce me" walks you
  over and shows both people why they should talk.
- **AI recaps**: a summary of each keynote and panel for the event page, and personalised recaps
  ("you talked with Sam about seed funding").
- **Voice clarity**: noise suppression and clarity for quiet or accented speakers (the proposal's
  equal-voices goal).
- Metered as AI credits (section 6), with clear consent before anything is transcribed.

**Done when:** matches acted on and conversation counts beat the keyword version in an A/B test.
*Size: L.*

### Chunk 12: Bigger events and more devices

- **500+ attendees**: interest management (only receive video and movement from people near you),
  overflow instances of the same venue with a "find my friends" hop between them, and stage
  broadcast to large audiences.
- **Phones and tablets**: touch controls, a simplified HUD, and portrait-friendly layout.
- **Accessibility**: keyboard-only play, screen-reader friendly HUD, reduced motion, colour-blind
  safe palettes, a "map mode" 2D view for anyone who finds 3D movement hard.
- **Recordings and replays** of talks (LiveKit Egress), shown on the event page afterwards.

**Done when:** a 500-person test event runs smoothly and the venue is usable on an iPad. *Size: L.*

### Chunk 13: Enterprise

SSO (SAML, OIDC), SCIM provisioning, enforced SSO, two-factor sign-in, data residency, per-event
end-to-end encryption, retention policies, audit export, SOC 2 groundwork, security questionnaire
pack, SLA. Unlocks company all-hands and annual contracts. *Size: L.*

### Chunk 14: Growth and integrations

- **Discover**: a public directory of upcoming public events and Spaces, so attendees find their next
  event in Mingle (this is what turns one-off visitors into regulars).
- **Referrals**: organisers get a free event pass for each organiser they refer who pays.
- **Integrations**: HubSpot and Salesforce lead sync, Slack and Teams (share events, post recaps),
  Zapier, Google and Outlook calendars, an embeddable "Join us in Mingle" button.
- **Shareable moments**: a group "photo" of avatars at the end of an event, made to share on
  LinkedIn with a link back.

*Size: M, ongoing.*

## 8. Milestones and order

| Milestone | Chunks | What it unlocks |
| --- | --- | --- |
| **A. Paid pilot** | 0, 1, 2, 3, 4 | Run three to five real events with friendly organisers (Cambridge network, a co-working space, a remote company social), charged by event pass with pilot coupons. Learn from the reports. |
| **B. Public launch** | 5, 6 | Self-serve organisers, retention loops live, pricing page public, Product Hunt and LinkedIn launch, the `/play` demo as the front door. |
| **C. More ways to earn** | 7, 8, 9 | Sponsors, ticketing and the shop; revenue per event goes up without charging attendees. |
| **D. Scale and reach** | 10, 11, 12, 13 | Bigger events, real venues, AI, enterprise contracts. |
| Ongoing | 14 | Growth loops once there is something to grow. |

Within milestone A, chunks 1 and 2 can run side by side; chunk 3 needs chunk 2's events and people;
chunk 4 needs 2 and is best shipped with 3 so the first paid event gets a report.

**Rule for every chunk**: ship behind a feature flag, try it in a two-browser test and in a real
event, then turn it on. Keep visuals calm (Phil's "less gaudy" feedback): fun never distracts from
the talk or the conversation.

## 9. Risks

| Risk | What we do about it |
| --- | --- |
| Novelty wears off after the first event | Lead with measurable value (reports, connections book), not gimmicks. Watch the 60-day return rate from the first pilot. |
| 3D is too heavy for some laptops or confusing for non-gamers | Load test early (chunk 1), low-power mode, first-run tips, "take me there" buttons everywhere, map mode (chunk 12). |
| Media costs eat the margin | Cost meter in chunk 3, distance-based video already in place, interest management, self-hosted LiveKit at scale. |
| Privacy: proximity data is personal data | Store rolled-up conversations, not trails; clear privacy notice; consent for card and lead sharing; UK/EU hosting; deletion on request. |
| Harassment in an open venue | Report, block, ban, code of conduct, host tools, word filters (chunk 1). |
| Crowded market of 2D proximity apps and event platforms | Our difference is first-person 3D with real faces and measured networking outcomes; stay focused on networking events rather than general meetings. |
| Small team, wide roadmap | Strict milestone order; nothing in C or D starts until A has paying pilots. |

## 10. Decisions for Phil

1. **Prices.** Section 6 gives starting numbers to test. Are you happy to pilot with event passes
   (£49/£149/£299) and the Free/Host/Pro shape?
2. **First niche.** Networking events and company socials first, conferences later. Agree?
3. **Free plan.** Recommended: attendee cap with no time limit, instead of today's 40-minute cut-off.
4. **Hosting.** Recommended: a managed UK/EU platform with LiveKit Cloud to launch; self-host later.
5. **Pilot customers.** Which three to five organisers from your network should we line up for
   milestone A?
6. **Name.** Mingle publicly, with Talking Heads as the story behind it, or the other way round?

---

## Appendix: delivered so far

- **Accounts, teams and billing**: accounts, organisations, roles, invitations; scheduled and instant
  events with invite links and calendar files; LiveKit video and audio; guest join and door queue;
  host mute, remove and end; Free/Pro/Business plans with Stripe Checkout, portal and webhooks;
  audit log, security headers, rate limits, CSRF protection; Docker, CI and docs.
- **The venue**: first-person lobby and auditorium with stage and big screen; telly-headed avatars
  with webcam faces, emotes, chat bubbles and a confetti cannon (lobby only); proximity voice with
  stereo panning; stage mic; distance-based video quality; bot-filled demo at `/play`; landing page
  built around "Where Zoom Meets Doom".
- **Calmer venue and the Talking Heads ideas**: calmer palette and quiet HUD; front-row view; raise
  hand and pass the mic; teleport; call everyone in; announcements; business cards with vCard/CSV
  export; "Ask me about" and "Here to" tags; matchmaking nudges; soundproof pods with whiteboards;
  discussion groups on tables; venue branding; voice levelling; live captions; gestures; avatar
  height, build, telly and props; reconnect that puts you back where you were.

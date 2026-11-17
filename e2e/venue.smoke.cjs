const { chromium } = require('playwright');
// Two people in a live venue: avatars sync, webcam faces, chat, the stage screen,
// cards, hands and the mic, pods, whiteboards, groups, branding, teleport,
// confetti hits and host removal.
// Usage: start livekit-server --dev and the app (API on 3000, web on 5173 or the
// built app on 3000), then: BASE_URL=http://localhost:5173 node e2e/venue.smoke.cjs
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SCREENSHOT_DIR ?? '.';
const W = (page, fn, arg) => page.evaluate(fn, arg);

function check(cond, msg) {
  if (!cond) throw new Error(`Check failed: ${msg}`);
  console.log('ok -', msg);
}

async function until(page, fn, arg, what, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, arg)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const mk = async () => {
    const c = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1100, height: 680 } });
    const p = await c.newPage();
    p.setDefaultTimeout(60000);
    p.on('pageerror', (e) => console.log('PAGEERR', e.message));
    p.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && console.log('CONSOLE', m.text()));
    return p;
  };
  const host = await mk();
  await host.goto(BASE + '/signup');
  await host.fill('input[autocomplete=name]', 'Phil Host');
  await host.fill('input[type=email]', `host${Date.now()}@example.com`);
  await host.fill('input[type=password]', 'a very long password');
  await host.fill('label:has-text("Company") input', 'Acme Ltd');
  await host.click('button:has-text("Create account")');
  await host.waitForSelector('text=Open a venue now');
  await host.screenshot({ path: `${SHOTS}/dashboard.png` });
  await host.click('text=Open a venue now');
  await host.waitForURL(/\/m\//);
  const url = host.url();
  await host.waitForSelector('.studio', { timeout: 15000 });
  // Frame the webcam: zoom in on the face, and see it on the live preview.
  await host.locator('input[aria-label="Zoom in on your face"]').fill('1.6');
  await host.waitForTimeout(2500);
  await host.screenshot({ path: `${SHOTS}/prejoin.png` });
  await host.click('button:has-text("Open the venue")');
  await host.waitForSelector('.world-canvas', { timeout: 20000 });

  const guest = await mk();
  await guest.goto(url);
  await guest.waitForSelector('.studio');
  await guest.getByLabel('Your name').fill('Gina Guest');
  await guest.click('button:has-text("Enter the venue")');
  await guest.waitForSelector('.world-canvas', { timeout: 20000 });

  // Both see each other's avatar.
  await until(host, () => window.__mingleWorld?.remoteIds().some((id) => window.__mingleWorld.remotePosition(id)), null, 'host to see guest');
  await until(guest, () => window.__mingleWorld?.remoteIds().some((id) => window.__mingleWorld.remotePosition(id)), null, 'guest to see host');
  check(true, 'avatars appear for both people');

  // Webcams become faces.
  await until(host, () => window.__mingleWorld.remoteIds().some((id) => window.__mingleWorld.getAvatar(id).hasVideo), null, 'guest webcam on host side');
  check(true, "guest's webcam shows on their avatar for the host");

  // Movement syncs: put the guest in front of the host.
  await W(guest, () => { const w = window.__mingleWorld; w.pos.set(0, 0, 11.5); w.yaw = Math.PI; });
  await W(host, () => { const w = window.__mingleWorld; w.pos.set(0, 0, 14.5); w.yaw = 0; w.pitch = 0; });
  await until(host, () => { const w = window.__mingleWorld; const id = w.remoteIds()[0]; const p = w.remotePosition(id); return p && Math.abs(p.z - 11.5) < 0.3; }, null, 'guest position to sync');
  check(true, 'positions sync between browsers');

  // Proximity voice: loud up close, quiet across the building.
  const vol = () => Object.values(window.__mingleSession.volumes())[0] ?? -1;
  await until(host, (fn) => eval(fn)() > 0.9, vol.toString(), 'full volume up close');
  check(true, 'voice is full volume up close');
  await W(guest, () => { const w = window.__mingleWorld; w.pos.set(-18, 0, 28); });
  await until(host, (fn) => { const v = eval(fn)(); return v >= 0 && v < 0.1; }, vol.toString(), 'voice to fade with distance');
  check(true, 'voice fades with distance');
  await W(guest, () => { const w = window.__mingleWorld; w.pos.set(0, 0, 11.5); w.yaw = Math.PI; });
  await until(host, () => { const w = window.__mingleWorld; const p = w.remotePosition(w.remoteIds()[0]); return p && Math.abs(p.z - 11.5) < 0.3; }, null, 'guest to come back');

  // Chat.
  await guest.click('text=Click to play');
  await guest.keyboard.press('Enter');
  await guest.fill('.chat-input', 'Hello from the guest');
  await guest.keyboard.press('Enter');
  await host.waitForSelector('.chat-line:has-text("Hello from the guest")', { timeout: 10000 });
  check(true, 'chat arrives');
  await host.click('text=Click to play');
  // Clicking moves the mouse, which turns the head; look straight at the guest again.
  await W(host, () => { const w = window.__mingleWorld; w.yaw = 0; w.pitch = 0; });
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${SHOTS}/venue-face-to-face.png` });

  // Name tags: "Ask me about" / "Here to" and avatar looks travel with the profile.
  await W(guest, () => window.__mingleSession.setProfile({ tag: 'pitch decks', goal: 'find funding', contact: 'gina@example.com', look: { height: 1.08, build: 0.9, tv: 'flat', prop: 'mug' } }));
  await until(host, () => [...window.__mingleSession.profiles.values()].some((p) => p.goal === 'find funding' && p.look.prop === 'mug' && p.look.tv === 'flat'), null, 'guest profile to sync');
  check(true, 'profile goals and avatar looks sync');

  // Webcam framing chosen before joining travels with the profile.
  await until(guest, () => [...window.__mingleSession.profiles.values()].some((p) => p.look.cam.zoom > 1.5), null, 'host framing to reach the guest');
  check(true, 'webcam framing syncs');

  // Heads: looking up tilts the telly up, and a small glance turns only the head.
  await W(guest, () => { const w = window.__mingleWorld; w.yaw = Math.PI; w.pitch = 0.5; });
  await until(host, () => { const w = window.__mingleWorld; return w.getAvatar(w.remoteIds()[0]).head.rotation.x > 0.2; }, null, 'guest head to tilt up');
  check(true, 'looking up tilts the head up for others');
  await host.waitForTimeout(1500);
  const bodyBefore = await W(host, () => { const w = window.__mingleWorld; return w.getAvatar(w.remoteIds()[0]).root.rotation.y; });
  await W(guest, () => { const w = window.__mingleWorld; w.yaw = Math.PI + 0.3; w.pitch = 0; });
  await until(host, () => { const w = window.__mingleWorld; return Math.abs(w.getAvatar(w.remoteIds()[0]).head.rotation.y) > 0.25; }, null, 'guest head to turn');
  const bodyAfter = await W(host, () => { const w = window.__mingleWorld; return w.getAvatar(w.remoteIds()[0]).root.rotation.y; });
  check(Math.abs(bodyAfter - bodyBefore) < 0.01, 'a small glance turns the head but not the body');
  await W(guest, () => { const w = window.__mingleWorld; w.yaw = Math.PI; });

  // Body language.
  await W(guest, () => window.__mingleSession.gesture('wave'));
  await until(host, () => { const w = window.__mingleWorld; return w.getAvatar(w.remoteIds()[0]).gesture?.kind === 'wave'; }, null, 'wave to show');
  check(true, 'gestures sync');

  // Business cards: the guest hands theirs to the host.
  const hostId = await W(host, () => window.__mingleSession.room.localParticipant.identity);
  const guestId = await W(guest, () => window.__mingleSession.room.localParticipant.identity);
  await W(guest, (id) => window.__mingleSession.giveCard(id), hostId);
  await host.waitForSelector('.hud-btn:has-text("Cards 1")');
  check(true, 'business card arrives');

  // Raise a hand, host passes the mic.
  await W(guest, () => window.__mingleSession.setHand(true));
  await until(host, (id) => window.__mingleSession.hands.has(id), guestId, 'raised hand to show');
  await W(host, (id) => window.__mingleSession.passMic(id), guestId);
  await until(guest, (id) => window.__mingleSession.micHolder === id && !window.__mingleSession.handUp, guestId, 'mic to reach the guest');
  await W(host, () => window.__mingleSession.passMic(null));
  check(true, 'raise hand and pass the mic');

  // Soundproof pods: guest steps into a pod right next to the host outside.
  await W(guest, () => { const w = window.__mingleWorld; w.pos.set(-14, 0, 24.5); });
  await W(host, () => { const w = window.__mingleWorld; w.pos.set(-14, 0, 22.5); });
  await until(host, (fn) => eval(fn)() === 0, vol.toString(), 'pod to block sound');
  check(true, 'pods are soundproof');

  // Shared whiteboard.
  await W(guest, () => window.__mingleSession.stroke({ b: 'podA', c: '#c8505f', w: 30, p: [500, 500, 600, 500] }));
  await until(host, () => { const d = window.__mingleWorld.venue.boards.podA.canvas.getContext('2d').getImageData(560, 288, 1, 1).data; return d[0] > 150 && d[1] < 120; }, null, 'stroke to appear on the host board');
  check(true, 'whiteboard strokes sync');

  // Discussion groups and branding from the host tools.
  await host.keyboard.press('Tab');
  await host.selectOption('.host-tools select', '2');
  await host.click('button:has-text("Split the room")');
  await guest.waitForSelector('text=split the room into discussion groups');
  const nearTable = await W(guest, () => { const w = window.__mingleWorld; return w.venue.groupTables.some((t) => Math.hypot(t.x - w.pos.x, t.y - w.pos.z) < 2); });
  check(nearTable, 'discussion groups seat people at tables');
  await host.click('button:has-text("End groups")');
  await host.fill('input[placeholder^="Event name"]', 'Cambridge Tech Week');
  await host.fill('input[placeholder^="Sponsor"]', 'Boondoggle');
  await host.click('button:has-text("Update signs")');
  await until(guest, () => window.__mingleSession.branding?.name === 'Cambridge Tech Week', null, 'branding to reach the guest');
  check(true, 'host branding reaches everyone');
  await host.keyboard.press('Tab');

  // Teleport next to someone.
  await W(host, (id) => window.__mingleWorld.teleportTo(id), guestId);
  const close = await W(host, (id) => { const w = window.__mingleWorld; const p = w.remotePosition(id); return p && Math.hypot(p.x - w.pos.x, p.z - w.pos.z) < 3; }, guestId);
  check(close, 'teleport lands next to them');

  // Back to face to face for the confetti test.
  await W(guest, () => { const w = window.__mingleWorld; w.pos.set(0, 0, 11.5); w.yaw = Math.PI; });
  await W(host, () => { const w = window.__mingleWorld; w.pos.set(0, 0, 14.5); w.yaw = 0; w.pitch = 0; });
  await until(host, () => { const w = window.__mingleWorld; const p = w.remotePosition(w.remoteIds()[0]); return p && Math.abs(p.z - 11.5) < 0.3; }, null, 'guest to come back');

  // Confetti: host shoots the guest.
  await W(host, () => { const w = window.__mingleWorld; w.yaw = 0; w.pitch = -0.05; });
  await host.waitForTimeout(200);
  await W(host, () => window.__mingleWorld.fire());
  await until(guest, () => Number(document.querySelector('.world')?.dataset.splatted) > 0, null, 'the guest to get confetti', 20000);
  await host.waitForSelector('text=Confetti landed: 1');
  check(true, 'confetti hit reaches the target');
  await guest.screenshot({ path: `${SHOTS}/venue-splat.png` });

  // Host ropes off the stage: the guest can't get up there until made a presenter.
  await W(host, () => window.__mingleSession.setStageLocked(true));
  await until(guest, () => window.__mingleWorld.stageRestrictedForMe, null, 'stage rope to reach the guest');
  const refused = await W(guest, () => !window.__mingleWorld.teleport(5.6, -29));
  check(refused, 'audience cannot get past the stage rope');
  await W(host, (id) => window.__mingleSession.setPresenter(id, true), guestId);
  await until(guest, () => !window.__mingleWorld.stageRestrictedForMe, null, 'guest to be let through');
  check(true, 'host can make someone a presenter');

  // Hush the audience: mics in the auditorium go off.
  await W(guest, () => { const w = window.__mingleWorld; w.pos.set(3, 0, -10); });
  await until(guest, () => window.__mingleSession.room.localParticipant.isMicrophoneEnabled, null, 'guest mic on');
  await W(host, () => { const w = window.__mingleWorld; w.pos.set(0, 0, -6); });
  await host.waitForTimeout(500);
  await host.keyboard.press('Tab');
  await host.locator('label:has-text("Hush the audience") input').check();
  await until(guest, () => !window.__mingleSession.room.localParticipant.isMicrophoneEnabled, null, 'guest mic to be hushed');
  check(true, 'hushing the audience mutes mics in the auditorium');
  await host.locator('label:has-text("Hush the audience") input').uncheck();
  await host.keyboard.press('Tab');
  await W(guest, () => window.__mingleSession.room.localParticipant.setMicrophoneEnabled(true));

  // Stage: guest walks on stage, host sees them on the big screen.
  await W(guest, () => { const w = window.__mingleWorld; w.teleport(5.6, -28.95, Math.PI); });
  await W(host, () => { const w = window.__mingleWorld; w.pos.set(0, 0, -6); w.yaw = 0; w.pitch = 0.12; });
  await until(host, () => window.__mingleWorld.venue.screen.material.map?.isVideoTexture === true, null, 'stage camera on the big screen', 20000);
  check(true, 'presenter camera appears on the big screen');
  await until(host, (fn) => eval(fn)() > 0.9, vol.toString(), 'stage mic to reach the hall');
  check(true, 'stage mic reaches the back of the auditorium');
  await host.waitForTimeout(2000);
  await host.screenshot({ path: `${SHOTS}/venue-keynote.png` });

  // Slides: the presenter uploads a PowerPoint deck and flicks to slide 2.
  if (process.env.DECK) {
    await guest.setInputFiles('input[type=file][accept*=pdf]', process.env.DECK);
    await guest.waitForSelector('.slide-bar:has-text("Slide 1 of")', { timeout: 60000 });
    await guest.keyboard.press('PageDown');
    await guest.waitForSelector('.slide-bar:has-text("Slide 2 of")');
    await until(host, () => [...window.__mingleSession.room.remoteParticipants.values()].some((p) => [...p.trackPublications.values()].some((t) => t.trackName === 'slides' && t.isSubscribed)), null, 'slides to reach the host', 20000);
    check(true, 'uploaded slides go on the big screen for everyone');
    await W(host, () => { const w = window.__mingleWorld; w.pos.set(-2, 0, -12); w.yaw = -0.12; w.pitch = 0.2; });
    await host.waitForTimeout(3000);
    await host.screenshot({ path: `${SHOTS}/venue-slides.png` });
    await guest.screenshot({ path: `${SHOTS}/presenter-view.png` });
  }

  // Host removes guest.
  await host.keyboard.press('Tab');
  const removeBtn = host.locator('.host-panel button:has-text("Remove")').first();
  host.once('dialog', (d) => d.accept());
  await removeBtn.click();
  await guest.waitForSelector('text=The host removed you', { timeout: 30000 }).catch(async (e) => {
    await guest.screenshot({ path: `${SHOTS}/guest-after-remove.png` });
    console.log('guest text:', (await guest.textContent('body')).slice(0, 300));
    throw e;
  });
  check(true, 'host can remove someone');
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});

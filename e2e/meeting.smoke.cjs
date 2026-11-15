const { chromium } = require('playwright');
// Usage: start livekit-server --dev and the app (port 3000), then: node e2e/meeting.smoke.cjs
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const mk = async () => { const c = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } }); const p = await c.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text()); }); return p; };
  const host = await mk();
  await host.goto(BASE + '/');
  await host.screenshot({ path: `${process.env.SCREENSHOT_DIR ?? '.'}/landing.png`, fullPage: true });
  await host.goto(BASE + '/signup');
  await host.fill('input[autocomplete=name]', 'Phil Host');
  await host.fill('input[type=email]', `host${Date.now()}@example.com`);
  await host.fill('input[type=password]', 'a very long password');
  await host.fill('label:has-text("Company") input', 'Acme Ltd');
  await host.click('button:has-text("Create account")');
  await host.waitForSelector('text=Start a meeting now');
  await host.screenshot({ path: `${process.env.SCREENSHOT_DIR ?? '.'}/dashboard.png` });
  await host.click('text=Start a meeting now');
  await host.waitForURL(/\/m\//);
  const url = host.url();
  console.log('meeting url', url);
  await host.waitForSelector('.lk-prejoin', { timeout: 15000 });
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${process.env.SCREENSHOT_DIR ?? '.'}/prejoin.png` });
  await host.click('button:has-text("Start meeting")');
  await host.waitForSelector('.lk-video-conference', { timeout: 20000 });

  const guest = await mk();
  await guest.goto(url);
  await guest.waitForSelector('.lk-prejoin');
  await guest.fill('.lk-prejoin input#username', 'Gina Guest');
  await guest.click('button:has-text("Join meeting")');
  await guest.waitForSelector('.lk-video-conference', { timeout: 20000 });
  await guest.waitForTimeout(4000);
  const tilesHost = await host.locator('.lk-participant-tile').count();
  const tilesGuest = await guest.locator('.lk-participant-tile').count();
  console.log('tiles host/guest', tilesHost, tilesGuest);
  // Chat
  await guest.click('.lk-chat-toggle');
  await guest.fill('.lk-chat-form-input', 'Hello from the guest');
  await guest.press('.lk-chat-form-input', 'Enter');
  await host.click('.lk-chat-toggle');
  await host.waitForSelector('text=Hello from the guest', { timeout: 10000 });
  console.log('chat delivered');
  await host.waitForTimeout(1000);
  await host.screenshot({ path: `${process.env.SCREENSHOT_DIR ?? '.'}/room-host.png` });
  // Host removes guest
  const removeBtn = host.locator('.host-panel button:has-text("Remove")').first();
  host.once('dialog', d => d.accept());
  await removeBtn.click();
  await guest.waitForSelector('text=The host removed you', { timeout: 10000 });
  console.log('remove works');
  await guest.screenshot({ path: `${process.env.SCREENSHOT_DIR ?? '.'}/guest-removed.png` });
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

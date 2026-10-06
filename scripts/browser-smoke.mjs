// Optional browser integration checks. Start Vite first (npm run dev).
// Uses installed playwright-core and system Chromium. Set FELIS_CHROMIUM for another executable.
// Example: npm run test:browser (with Vite running on port 3000).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium } = await import(process.env.FELIS_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({
  executablePath: process.env.FELIS_CHROMIUM || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const url = process.env.FELIS_URL || 'http://localhost:3000';
const artifacts = process.env.FELIS_ARTIFACT_DIR;
if (artifacts) await mkdir(artifacts, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const passed = [];
const observeErrors = observedPage => {
  observedPage.on('pageerror', error => errors.push(error.message));
  observedPage.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  observedPage.on('response', response => { if (response.status() >= 400) errors.push(`${response.url()}: HTTP ${response.status()}`); });
};
observeErrors(page);
const state = () => page.evaluate(() => window.felis.getState());
const wait = ms => page.waitForTimeout(ms);
const reset = async () => { await page.keyboard.press('r'); await wait(50); };
const verify = (name, condition) => { assert.ok(condition, name); passed.push(name); };
const jump = async hold => {
  await reset(); await page.keyboard.down('s');
  if (!hold) { await wait(50); await page.keyboard.up('s'); }
  const samples = [];
  for (let i = 0; i < 34; i++) { await wait(35); samples.push(await state()); }
  if (hold) await page.keyboard.up('s');
  const final = await state();
  return { height: Math.max(...samples.map(s => s.terrainY - 44 - s.y)), final };
};
try {
  await page.goto(url); await page.waitForFunction(() => window.felis?.getState);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (artifacts) await page.screenshot({ path: join(artifacts, 'desktop.png') });
  await page.keyboard.down('ArrowRight'); await wait(80); const accelerating = await state();
  await page.waitForFunction(() => window.felis.getState().vx >= 137); const walking = await state();
  verify('accelerates to walking speed', accelerating.vx > 0 && accelerating.vx < walking.vx && Math.abs(walking.vx - 138) < 2);
  await page.keyboard.down('a'); await page.waitForFunction(() => window.felis.getState().vx >= 309); const running = await state();
  verify('A accelerates to running speed', Math.abs(running.vx - 310) < 2);
  await page.keyboard.up('ArrowRight'); await page.keyboard.up('a'); await wait(80); const coasting = await state();
  verify('release retains inertia', coasting.vx > 0 && coasting.vx < running.vx && coasting.x > running.x);
  await page.waitForFunction(() => window.felis.getState().vx === 0, null, { timeout: 5000 });
  await page.keyboard.down('ArrowRight'); await page.waitForFunction(() => window.felis.getState().vx >= 137);
  const beforeReversal = await state(); await page.keyboard.up('ArrowRight'); await page.keyboard.down('ArrowLeft'); await wait(35); const braking = await state();
  await page.waitForFunction(() => window.felis.getState().vx <= -137); const reversed = await state(); await page.keyboard.up('ArrowLeft');
  verify('reversal brakes before facing left', braking.vx > 0 && braking.vx < beforeReversal.vx && reversed.facing === -1);
  const tap = await jump(false), hold = await jump(true);
  verify('held jump rises higher', tap.height > 15 && hold.height > tap.height + 25);
  verify('held jump lands without repeating', tap.final.grounded && hold.final.grounded && tap.final.jumpCount === 1 && hold.final.jumpCount === 1);
  await reset(); await page.keyboard.press('s'); await wait(80); await page.keyboard.press('s');
  verify('no midair double jump', (await state()).jumpCount === 1); await wait(1000);
  await page.keyboard.press('x');
  verify('X toggles skeleton and aria', (await state()).skeleton && await page.locator('#skeleton').getAttribute('aria-pressed') === 'true');
  if (artifacts) await page.screenshot({ path: join(artifacts, 'skeleton.png') });
  await page.keyboard.press('x'); await page.keyboard.down('ArrowRight'); await wait(300); await page.keyboard.press('Space');
  const paused = await state(); await wait(200); const frozen = await state();
  verify('space pauses physics', paused.paused && frozen.x === paused.x && frozen.y === paused.y);
  await page.keyboard.up('ArrowRight'); await page.keyboard.press('Space'); verify('space resumes', !(await state()).paused);
  await reset(); const resetState = await state(); verify('R resets simulation', resetState.x === 0 && resetState.vx === 0 && resetState.jumpCount === 0);
  await page.locator('#help').click(); verify('instructions pause simulation', (await state()).paused && await page.locator('#instructions').evaluate(el => el.open));
  await page.locator('#close-help').click(); await page.waitForFunction(() => !window.felis.getState().paused); verify('closing instructions resumes', !(await page.locator('#instructions').evaluate(el => el.open)));
  await page.locator('#help').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#instructions').open && window.felis.getState().paused);
  verify('focused help opens with Space', await page.locator('#instructions').evaluate(el => el.open));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.felis.getState().paused);
  verify('Escape closes help and restores simulation', !(await page.locator('#instructions').evaluate(el => el.open)));
  await page.locator('#pause').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => window.felis.getState().paused);
  await page.locator('#resume').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.felis.getState().paused);
  verify('focused pause and resume activate with Space', !(await state()).paused);
  await page.locator('#skeleton').focus(); await page.keyboard.press('Space');
  verify('focused skeleton activates without pausing', (await state()).skeleton && !(await state()).paused);
  await page.keyboard.press('Space');
  await page.locator('[data-hold="right"]').focus(); await page.keyboard.down('Enter');
  await page.waitForFunction(() => window.felis.getState().vx >= 137); const keyboardWalk = await state();
  verify('focused direction holds with Enter without pausing', keyboardWalk.vx >= 137 && !keyboardWalk.paused);
  await page.keyboard.up('Enter'); await wait(80); const keyboardCoast = await state();
  verify('focused direction release retains inertia', keyboardCoast.vx > 0 && keyboardCoast.vx < keyboardWalk.vx);
  await page.waitForFunction(() => window.felis.getState().vx === 0, null, { timeout: 5000 });
  verify('focused direction release eventually stops', (await state()).vx === 0);
  await page.locator('[data-hold="jump"]').focus(); await page.keyboard.down('Space'); await wait(150);
  const keyboardJump = await state();
  verify('focused jump holds with Space without pausing', !keyboardJump.grounded && keyboardJump.jumpCount === 1 && !keyboardJump.paused);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.felis.getState().grounded, null, { timeout: 5000 }); await wait(100);
  verify('focused jump ignores repeated keydown', (await state()).jumpCount === 1 && (await state()).grounded);
  await page.keyboard.up('Space');
  await page.locator('[data-hold="right"]').focus(); await page.keyboard.down('Enter');
  await page.waitForFunction(() => window.felis.getState().vx >= 137); await page.locator('#help').focus();
  await page.waitForFunction(() => window.felis.getState().vx === 0, null, { timeout: 5000 });
  verify('focused control blur ends its hold', (await state()).vx === 0 && !(await state()).paused);
  await page.keyboard.up('Enter'); await page.evaluate(() => document.activeElement?.blur()); await reset();
  await page.locator('#sound').click(); verify('sound control toggles', await page.locator('#sound').getAttribute('aria-pressed') === 'true'); await page.locator('#sound').click();
  const right = await page.locator('[data-hold="right"]').boundingBox();
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2); await page.mouse.down(); await wait(600);
  verify('onscreen direction holds', (await state()).vx > 130); await page.mouse.up(); await reset();
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await wait(100);
    const fits = await page.evaluate(() => ! (document.documentElement.scrollWidth > innerWidth) && [...document.querySelectorAll('.controls button, .toolbar button')].every(el => {
      const r = el.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth + .1 && r.bottom <= innerHeight + .1;
    }));
    verify(`controls fit ${viewport.width}x${viewport.height}`, fits);
  }
  const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  observeErrors(touchPage); await touchPage.goto(url); await touchPage.waitForFunction(() => window.felis?.getState);
  if (artifacts) await touchPage.screenshot({ path: join(artifacts, 'mobile.png') });
  const cdp = await touchPage.context().newCDPSession(touchPage);
  const center = async selector => { const r = await touchPage.locator(selector).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const rightTouch = await center('[data-hold="right"]'), runTouch = await center('[data-hold="run"]'), jumpTouch = await center('[data-hold="jump"]');
  const point = (position, id) => ({ ...position, id, radiusX: 8, radiusY: 8, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(rightTouch, 0), point(runTouch, 1)] });
  await touchPage.waitForFunction(() => window.felis.getState().vx >= 309); verify('two touch pointers run', (await touchPage.evaluate(() => window.felis.getState())).vx >= 309);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(rightTouch, 0), point(runTouch, 1), point(jumpTouch, 2)] }); await touchPage.waitForTimeout(150);
  const touchJump = await touchPage.evaluate(() => window.felis.getState()); verify('third pointer jumps while running', !touchJump.grounded && touchJump.vy < 0 && touchJump.vx > 250);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchPage.waitForFunction(() => { const s = window.felis.getState(); return s.grounded && s.vx === 0; }, null, { timeout: 5000 });
  verify('touch release does not stick', true); await touchPage.close();
  verify('no browser or network errors', errors.length === 0);
  console.log(JSON.stringify({ passed: passed.length, checks: passed, errors }, null, 2));
} finally { await browser.close(); }

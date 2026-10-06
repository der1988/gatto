import test from 'node:test';
import assert from 'node:assert/strict';
import { Cat } from '../src/cat.js';
import { terrain as landscape } from '../src/world.js';

const DT = 1 / 120;
const flat = () => 500;
const advance = (cat, seconds, input = {}, dt = DT) => {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) cat.update(dt, input);
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const close = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} / ${expected}`);
};

test('acceleration, coasting, braking and reversal preserve inertia', () => {
  const cat = new Cat({ terrain: flat });
  cat.update(DT, { direction: 1, run: true });
  assert.ok(cat.vx > 0 && cat.vx < 10, 'running begins gradually');
  advance(cat, 1, { direction: 1, run: true });
  close(cat.vx, 310, 0.01, 'top running speed');
  const beforeRelease = cat.x;
  cat.update(DT, {});
  assert.ok(cat.vx > 300, 'releasing movement does not instantly stop the body');
  advance(cat, 1);
  close(cat.vx, 0, 0.01, 'friction eventually stops the cat');
  assert.ok(cat.x - beforeRelease > 90 && cat.x - beforeRelease < 120, 'stopping distance reflects momentum');
  advance(cat, 1, { direction: 1, run: true });
  cat.update(DT, { direction: -1, run: true });
  assert.ok(cat.vx > 0 && cat.facing === 1, 'reverse input first brakes forward momentum');
  advance(cat, 0.8, { direction: -1, run: true });
  assert.ok(cat.vx < -300 && cat.facing === -1, 'the cat turns once actual motion reverses');
});

function jumpHeight(holdSeconds) {
  const cat = new Cat({ terrain: flat });
  const initialY = cat.y;
  let apex = initialY;
  for (let i = 0; i < 150; i += 1) {
    cat.update(DT, { jumpPressed: i === 0, jumpHeld: i * DT < holdSeconds });
    apex = Math.min(apex, cat.y);
  }
  assert.ok(cat.grounded, 'the jump returns to the ground');
  close(cat.y, initialY, 1e-8, 'landing returns to the support height');
  return initialY - apex;
}

test('holding the jump key produces a higher jump than a short tap', () => {
  const short = jumpHeight(0.055);
  const held = jumpHeight(0.3);
  assert.ok(short > 15, 'a short press still lifts the cat');
  assert.ok(held > short + 35, 'holding the key materially increases jump height');
  assert.ok(held < 110, 'jump energy remains bounded');
});

test('jump cannot be repeated in midair; landing settles without vertical drift', () => {
  const cat = new Cat({ terrain: flat });
  cat.update(DT, { jumpPressed: true, jumpHeld: true });
  advance(cat, 0.14, { jumpHeld: true });
  assert.equal(cat.grounded, false);
  const beforeAttempt = cat.vy;
  cat.update(DT, { jumpPressed: true, jumpHeld: true });
  assert.equal(cat.jumpCount, 1);
  assert.ok(cat.vy > beforeAttempt, 'an airborne press does not reapply the jump impulse');
  advance(cat, 1.5);
  assert.equal(cat.grounded, true);
  close(cat.vy, 0, 1e-10, 'landed vertical velocity');
  const y = cat.y;
  advance(cat, 4);
  close(cat.y, y, 1e-10, 'stationary body has no accumulating drift');
  assert.ok(Math.abs(cat._squash) < 0.001, 'landing compression settles');
});

test('planted paws stay fixed and IK preserves anatomical segment lengths', () => {
  const terrain = x => 500 + Math.sin(x / 180) * 9;
  const cat = new Cat({ terrain });
  for (let i = 0; i < 1800; i += 1) {
    const previous = cat.legs.map(leg => ({ stance: leg.stance, x: leg.paw.x }));
    const priorFacing = cat.facing;
    cat.update(DT, { direction: i < 1200 ? 1 : 0, run: i > 250 });
    cat.legs.forEach((leg, index) => {
      const { root, joint, ankle } = leg.pose;
      close(distance(root, joint), leg.kind === 'hind' ? 22 : 18, 0.01, `${leg.name}: proximal bone`);
      close(distance(joint, ankle), leg.kind === 'hind' ? 24 : 20, 0.01, `${leg.name}: distal bone`);
      if (leg.stance) {
        close(leg.paw.y, terrain(leg.paw.x) - 1.5, 1e-8, `${leg.name}: terrain contact`);
        if (previous[index].stance && priorFacing === cat.facing) {
          close(leg.paw.x, previous[index].x, 1e-8, `${leg.name}: stance does not slide`);
        }
      }
    });
  }
});

test('a downhill slope supports all paws and jump landing', () => {
  const terrain = x => 500 - x * 0.09;
  const cat = new Cat({ terrain });
  for (let i = 0; i < 900; i += 1) {
    cat.update(DT, { direction: 1, run: true, jumpPressed: i === 350, jumpHeld: i >= 350 && i < 378 });
    if (cat.grounded) {
      close(cat.y, (terrain(cat.x - 24) + terrain(cat.x + 24)) / 2 - 44, 1e-8, 'sloped support');
      for (const leg of cat.legs) {
        if (leg.stance) close(leg.paw.y, terrain(leg.paw.x) - 1.5, 1e-8, 'downhill paw contact');
      }
    }
  }
  assert.equal(cat.jumpCount, 1);
  assert.equal(cat.grounded, true);
});

test('fixed simulation steps give identical motion across render frame groupings', () => {
  const sixtyHz = new Cat({ terrain: flat });
  const thirtyHz = new Cat({ terrain: flat });
  const simulate = (cat, stepsPerFrame) => {
    for (let frame = 0; frame < 720 / stepsPerFrame; frame += 1) {
      for (let substep = 0; substep < stepsPerFrame; substep += 1) {
        const step = frame * stepsPerFrame + substep;
        cat.update(DT, { direction: step < 500 ? 1 : -1, run: step > 120,
          jumpPressed: step === 280, jumpHeld: step >= 280 && step < 312 });
      }
    }
  };
  simulate(sixtyHz, 2);
  simulate(thirtyHz, 4);
  for (const key of ['x', 'y', 'vx', 'vy', 'phase']) close(sixtyHz[key], thirtyHz[key], 1e-12, key);
  assert.equal(sixtyHz.jumpCount, thirtyHz.jumpCount);
});

test('extended movement, jumps and direction changes keep the complete rig finite', () => {
  const cat = new Cat({ terrain: x => 500 + Math.sin(x / 230) * 18 });
  for (let i = 0; i < 14400; i += 1) {
    const block = Math.floor(i / 480);
    cat.update(DT, { direction: block % 3 === 2 ? 0 : block % 2 ? -1 : 1,
      run: block % 4 !== 0, jumpPressed: i % 420 === 140,
      jumpHeld: i % 420 >= 140 && i % 420 < 174 });
    for (const value of [cat.x, cat.y, cat.vx, cat.vy, ...cat.pose.tail.flatMap(node => [node.x, node.y])]) {
      assert.ok(Number.isFinite(value), 'body and tail remain finite');
    }
    for (const leg of cat.legs) {
      for (const node of Object.values(leg.pose)) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    }
  }
  assert.ok(cat.jumpCount > 20, 'the long run exercises repeated jumps');
});

test('ridge terrain, airborne turns and gait changes never stretch a bone or slide a planted toe', () => {
  const cat = new Cat({ terrain: landscape });
  for (let i = 0; i < 15000; i += 1) {
    const previous = cat.legs.map(leg => ({ stance: leg.stance, x: leg.paw.x }));
    const priorFacing = cat.facing;
    const priorGrounded = cat.grounded;
    cat.update(DT, {
      direction: Math.floor(i / 150) % 4 < 2 ? 1 : -1,
      run: Math.floor(i / 450) % 2 === 0,
      jumpPressed: i % 630 === 0,
      jumpHeld: i % 630 < 35,
    });
    cat.legs.forEach((leg, index) => {
      const { root, joint, ankle } = leg.pose;
      close(distance(root, joint), leg.kind === 'hind' ? 22 : 18, 1e-6, `${leg.name}: stress proximal bone`);
      close(distance(joint, ankle), leg.kind === 'hind' ? 24 : 20, 1e-6, `${leg.name}: stress distal bone`);
      if (cat.grounded && leg.stance) {
        close(leg.paw.y, landscape(leg.paw.x) - 1.5, 1e-8, `${leg.name}: stress contact`);
        if (priorGrounded && previous[index].stance && priorFacing === cat.facing) {
          close(leg.paw.x, previous[index].x, 1e-8, `${leg.name}: stress contact stays fixed`);
        }
      }
    });
  }
});

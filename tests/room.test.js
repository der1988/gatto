import test from 'node:test';
import assert from 'node:assert/strict';
import { Cat } from '../src/cat.js';
import { Laser, ROOM_BOUNDS, ROOM_PLATFORMS, roomTerrain } from '../src/room.js';

const DT = 1 / 120;
const sofa = { id: 'sofa', x1: -140, x2: 100, y: -64, solid: true };
const room = platforms => Object.assign(() => 0, {
  bounds: { min: -580, max: 580, ceiling: -340 },
  platforms,
});
const simulate = (cat, seconds, input = {}) => {
  for (let i = 0; i < Math.round(seconds / DT); i += 1) cat.update(DT, input);
};
const close = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} / ${expected}`);
const rigid = cat => cat.legs.forEach(leg => {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  close(distance(leg.pose.root, leg.pose.joint), leg.kind === 'hind' ? 22 : 18, 1e-6, 'room proximal bone');
  close(distance(leg.pose.joint, leg.pose.ankle), leg.kind === 'hind' ? 24 : 20, 1e-6, 'room distal bone');
});

function landOnSofa() {
  const terrain = room([sofa]);
  const cat = new Cat({ x: -240, terrain });
  simulate(cat, 2, { direction: 1, run: true });
  assert.ok(cat.x < sofa.x1, 'the solid sofa blocks approach from the floor');
  close(cat.y, -cat.supportHeight, 1e-8, 'floor approach does not teleport to the sofa top');
  let landed = false;
  for (let i = 0; i < 180; i += 1) {
    cat.update(DT, { direction: 1, run: true, jumpPressed: i === 0, jumpHeld: i < 34 });
    rigid(cat);
    if (cat.grounded && i > 5) {
      assert.ok(cat.x > sofa.x1 && cat.x < sofa.x2, 'a jump clears the sofa side before landing');
      close(cat.y, sofa.y - cat.supportHeight, 1e-8, 'jump lands on the actual top plane');
      landed = true; break;
    }
  }
  assert.ok(landed, 'a physically reachable jump lands on the sofa');
  return cat;
}

test('solid room walls stop movement and reversals stay inside the enclosure', () => {
  const terrain = room([]);
  const cat = new Cat({ terrain });
  for (let i = 0; i < 1600; i += 1) {
    cat.update(DT, { direction: i < 800 ? 1 : -1, run: true });
    assert.ok(cat.x >= terrain.bounds.min && cat.x <= terrain.bounds.max, 'the body remains inside both walls');
    rigid(cat);
  }
  assert.ok(cat.x < -500, 'the test reaches the opposite wall');
  simulate(cat, .3, { direction: -1, run: true });
  close(cat.vx, 0, 1e-8, 'blocked wall velocity settles to zero');
});

test('a solid sofa blocks floor entry and can be reached by a real jump', () => {
  const cat = landOnSofa();
  simulate(cat, .25);
  for (const leg of cat.legs) {
    if (!leg.stance) continue;
    assert.ok(leg.paw.x >= sofa.x1 && leg.paw.x <= sofa.x2, 'supported toes lie on the furniture top');
    close(leg.paw.y, sofa.y - 1.5 * cat.size, 1e-8, 'furniture support scales with paw thickness');
  }
});

test('walking off a furniture edge begins a fall without teleporting to the floor', () => {
  const cat = landOnSofa();
  let beganFalling = false;
  for (let i = 0; i < 300; i += 1) {
    const previous = { y: cat.y, grounded: cat.grounded };
    cat.update(DT, { direction: 1, run: true });
    rigid(cat);
    if (previous.grounded && !cat.grounded) {
      assert.ok(cat.y >= previous.y && cat.y - previous.y < 1, 'ledge exit continues from the old height under gravity');
      assert.ok(cat.y < -cat.supportHeight - 20, 'the body remains above the floor at ledge exit');
      beganFalling = true; break;
    }
  }
  assert.ok(beganFalling, 'the cat actually crosses the furniture edge');
  simulate(cat, 1.2);
  assert.equal(cat.grounded, true, 'the fall returns to the room floor');
  close(cat.y, -cat.supportHeight, 1e-8, 'floor landing uses the physical support height');
  rigid(cat);
});

test('a low ceiling interrupts an upward jump while preserving a rigid rig', () => {
  const terrain = room([]); terrain.bounds.ceiling = -72;
  const cat = new Cat({ terrain });
  let peak = cat.y;
  for (let i = 0; i < 160; i += 1) {
    cat.update(DT, { jumpPressed: i === 0, jumpHeld: i < 34 });
    assert.ok(cat.y >= terrain.bounds.ceiling, 'the body cannot cross the room ceiling');
    peak = Math.min(peak, cat.y); rigid(cat);
  }
  assert.ok(peak < -cat.supportHeight - 5, 'the low-ceiling case still exercises an upward jump');
  assert.equal(cat.grounded, true, 'ceiling contact allows a normal return to the floor');
});

test('pointer laser placement stays inside the room and outside solid furniture volumes', () => {
  const laser = new Laser();
  laser.place(-1e6, 0); assert.ok(laser.targetX >= ROOM_BOUNDS.min + 55, 'left target is reachable inside the wall');
  laser.place(1e6, 0); assert.ok(laser.targetX <= ROOM_BOUNDS.max - 55, 'right target is reachable inside the wall');
  for (const platform of ROOM_PLATFORMS) {
    const x = (platform.x1 + platform.x2) / 2;
    laser.place(x, platform.y); close(laser.targetY, platform.y - 2, 1e-8, 'laser attaches to a furniture top');
    laser.place(x, 0); assert.ok(laser.targetY <= platform.y - 2, 'laser is not hidden inside the solid base of furniture');
  }
});

test('a paw catches the laser once, updates the score and advances the objective', () => {
  const laser = new Laser(), cat = new Cat({ terrain: roomTerrain });
  const foot = cat.legs.find(leg => leg.stance).paw;
  laser.place(foot.x, foot.y);
  for (let i = 0; i < 240; i += 1) laser.update(DT, cat);
  assert.equal(laser.score, 1, 'one catch produces one point');
  assert.ok(Math.hypot(laser.x - foot.x, laser.y - foot.y) > 50, 'the next objective moves away from the captured paw');
  laser.reset(); assert.equal(laser.score, 0, 'restart clears the room objective score');
});

test('automatic instinct chases the complete laser course and jumps across furniture', () => {
  const laser = new Laser(), cat = new Cat({ x: -25, terrain: roomTerrain });
  const supported = new Set();
  for (let i = 0; i < 3600 && laser.score < 8; i += 1) {
    cat.update(DT, laser.inputFor(cat)); laser.update(DT, cat);
    assert.ok(cat.x >= ROOM_BOUNDS.min && cat.x <= ROOM_BOUNDS.max, 'automatic pursuit respects the walls');
    if (cat.platformId) supported.add(cat.platformId);
    rigid(cat);
  }
  assert.ok(laser.score >= 8, `the cat completes the eight-objective route (score ${laser.score})`);
  assert.ok(cat.jumpCount >= 3, 'the route includes real physics jumps');
  for (const platform of ROOM_PLATFORMS) assert.ok(supported.has(platform.id), `${platform.id} is reached by automatic pursuit`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Cat } from '../src/cat.js';
import { terrain as landscape } from '../src/world.js';
import { sampleGallop, GALLOP_FRAMES, GALLOP_CONTACT_WINDOWS, sampleWalk, sampleBrake } from '../src/reference-motion.js';

const DT = 1 / 120;
const flat = () => 500;
const advance = (cat, seconds, input = {}, dt = DT) => {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) cat.update(dt, input);
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const numericValues = value => typeof value === 'number' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(numericValues) : [];
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
  assert.ok(cat.vx > 280 && cat.vx < 310, 'releasing movement starts a decisive brake without instantly stopping');
  advance(cat, .075);
  assert.ok(cat.vx > 150 && cat.vx < 240, 'most running momentum is braked within the first eighty milliseconds');
  advance(cat, .25);
  close(cat.vx, 0, 0.01, 'friction eventually stops the cat');
  assert.ok(cat.x - beforeRelease > 30 && cat.x - beforeRelease < 50, 'stopping distance reflects momentum');
  advance(cat, 1, { direction: 1, run: true });
  cat.update(DT, { direction: -1, run: true });
  assert.ok(cat.vx > 0 && cat.facing === 1, 'reverse input first brakes forward momentum');
  advance(cat, 0.3, { direction: -1, run: true });
  assert.ok(cat.vx < 0 && cat.facing === -1, 'a reversal turns the cat within three tenths of a second');
  advance(cat, 0.5, { direction: -1, run: true });
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
        close(leg.paw.y, terrain(leg.paw.x) - 1.5 * cat.size, 1e-8, `${leg.name}: terrain contact`);
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
      close(cat.y, terrain(cat.x) - cat.supportHeight, 1e-8, 'sloped support');
      for (const leg of cat.legs) {
        if (leg.stance) close(leg.paw.y, terrain(leg.paw.x) - 1.5 * cat.size, 1e-8, 'downhill paw contact');
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
    for (const value of [cat.x, cat.y, cat.vx, cat.vy, ...numericValues(cat.pose)]) {
      assert.ok(Number.isFinite(value), 'body and tail remain finite');
    }
    for (const leg of cat.legs) {
      for (const key of ['root', 'joint', 'ankle', 'paw']) {
        const node = leg.pose[key]; assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
      }
      assert.ok(numericValues(leg.pose).every(Number.isFinite), 'limb points and paw rotations remain finite');
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
        close(leg.paw.y, landscape(leg.paw.x) - 1.5 * cat.size, 1e-8, `${leg.name}: stress contact`);
        if (priorGrounded && previous[index].stance && priorFacing === cat.facing) {
          close(leg.paw.x, previous[index].x, 1e-8, `${leg.name}: stress contact stays fixed`);
        }
      }
    });
  }
});

test('smaller physical scale matches support height and world-space paw contacts', () => {
  const cat = new Cat({ terrain: flat });
  close(cat.size, 0.6, 1e-12, 'the small physical cat matches the room scale');
  close(cat.supportHeight, 44 * cat.size, 1e-12, 'physical support scales with anatomy');
  close(cat.y, flat(cat.x) - cat.supportHeight, 1e-12, 'resting physical body height');
  for (let i = 0; i < 1400; i += 1) {
    cat.update(DT, { direction: i < 1000 ? 1 : -1, run: i > 220,
      jumpPressed: i === 480, jumpHeld: i >= 480 && i < 515 });
    for (const leg of cat.legs) {
      close(leg.paw.x, cat.x + cat.facing * cat.size * leg.pose.paw.x, 1e-8, `${leg.name}: local/world paw X`);
      close(leg.paw.y, cat.y + cat.size * leg.pose.paw.y, 1e-8, `${leg.name}: local/world paw Y`);
      if (leg.stance) close(leg.paw.y, flat(leg.paw.x) - 1.5 * cat.size, 1e-8, `${leg.name}: scaled contact`);
    }
  }
});

test('jump anatomy gathers at the apex and extends for ascent and landing', () => {
  const cat = new Cat({ terrain: flat });
  const snapshots = { ascent: [], apex: [], descent: [] };
  for (let i = 0; i < 140; i += 1) {
    cat.update(DT, { jumpPressed: i === 0, jumpHeld: i < 34 });
    for (const leg of cat.legs) {
      const { root, joint, ankle } = leg.pose;
      close(distance(root, joint), leg.kind === 'hind' ? 22 : 18, 1e-6, 'jump proximal bone stays rigid');
      close(distance(joint, ankle), leg.kind === 'hind' ? 24 : 20, 1e-6, 'jump distal bone stays rigid');
    }
    if (cat.grounded || cat._jumpTime < 0.08) continue;
    const front = cat.legs.filter(leg => leg.kind === 'front');
    const shape = {
      reach: front.reduce((sum, leg) => sum + distance(leg.pose.root, leg.pose.ankle), 0) / front.length,
      footForward: front.reduce((sum, leg) => sum + leg.pose.paw.x - leg.pose.root.x, 0) / front.length,
    };
    if (cat.vy < -180) snapshots.ascent.push(shape);
    if (Math.abs(cat.vy) < 40) snapshots.apex.push(shape);
    if (cat.vy > 180) snapshots.descent.push(shape);
  }
  for (const [phase, samples] of Object.entries(snapshots)) assert.ok(samples.length > 1, `${phase} was exercised`);
  const mean = (phase, key) => snapshots[phase].reduce((sum, shape) => sum + shape[key], 0) / snapshots[phase].length;
  assert.ok(mean('ascent', 'reach') > mean('apex', 'reach') + 3, 'forelegs fold after takeoff');
  assert.ok(mean('descent', 'reach') > mean('apex', 'reach') + 3, 'forelegs unfold before contact');
  assert.ok(mean('descent', 'footForward') > mean('apex', 'footForward') + 3, 'front paws reach forward for landing');
  assert.equal(cat.grounded, true);
  assert.equal(cat.jumpCount, 1);
});

test('photographic gallop alternates extended and gathered suspension shapes', () => {
  assert.equal(GALLOP_FRAMES.length, 12, 'one complete reconstructed photographic stride');
  const extended = sampleGallop(0.1);
  const collected = sampleGallop(0.45);
  assert.ok(distance(extended.hip, extended.shoulder) > distance(collected.hip, collected.shoulder) + 8,
    'the extended spine is visibly longer than the collected spine');
  assert.ok(collected.spineArch > extended.spineArch + 5, 'collection arches the spine');
  for (const [name, pose] of [['extended', extended], ['collected', collected]]) {
    assert.ok(Object.values(pose.legs).every(leg => !leg.contact), `${name} suspension has no grounded foot`);
    assert.ok(Object.values(pose.legs).every(leg => leg.y < 44 + pose.bodyLift - 0.1), `${name} suspension clears all four toes`);
  }
  const support = sampleGallop(0.28);
  assert.ok(support.legs.frontFar.contact && support.legs.frontNear.contact, 'staggered front support follows extension');
  const push = sampleGallop(0.61);
  assert.ok(push.legs.hindFar.contact && push.legs.hindNear.contact, 'rear support follows collection');
});

test('reference interpolation wraps smoothly, remains finite and preserves landmarks', () => {
  const originalFrames = JSON.stringify(GALLOP_FRAMES);
  for (const phase of [-2.7, -1, -0.00001, 0, 0.071, 0.41, 0.99999, 1, 3.18]) {
    const values = numericValues(sampleGallop(phase));
    assert.ok(values.every(Number.isFinite), 'every sampled landmark remains finite');
    const repeated = numericValues(sampleGallop(phase + 4));
    values.forEach((value, index) => close(value, repeated[index], 1e-10, 'integer-period phase equivalence'));
  }
  const epsilon = 1e-5;
  const before = numericValues(sampleGallop(-epsilon));
  const seam = numericValues(sampleGallop(0));
  const after = numericValues(sampleGallop(epsilon));
  before.forEach((value, index) => {
    close(value, after[index], 0.03, 'no position jump at cycle wrap');
    close((seam[index] - value) / epsilon, (after[index] - seam[index]) / epsilon, 0.3,
      'matching interpolation velocity across cycle wrap');
  });
  for (let i = 0; i <= 2400; i += 1) {
    const pose = sampleGallop(i / 2400);
    assert.ok(numericValues(pose).every(Number.isFinite));
    for (const foot of Object.values(pose.legs)) {
      assert.ok(foot.y <= 44 + pose.bodyLift + 1e-8, 'spline feet never penetrate the ground plane');
      if (foot.contact) close(foot.y, 44 + pose.bodyLift, 1e-8, 'reference support height');
    }
  }
  assert.equal(JSON.stringify(GALLOP_FRAMES), originalFrames, 'sampling does not mutate observed landmarks');
});

test('the running rig has genuine gathered and extended four-paw flight', () => {
  const cat = new Cat({ terrain: flat });
  advance(cat, 2, { direction: 1, run: true });
  const seen = { extended: 0, collected: 0 };
  let minLength = Infinity, maxLength = 0;
  for (let i = 0; i < 600; i += 1) {
    cat.update(DT, { direction: 1, run: true });
    assert.ok(cat.pose.referenceBlend > 0.98, 'full running speed follows the photographic trajectory');
    const bodyLength = distance(cat.pose.hip, cat.pose.shoulder);
    minLength = Math.min(minLength, bodyLength); maxLength = Math.max(maxLength, bodyLength);
    const flight = cat.phase > 0.04 && cat.phase < 0.13 ? 'extended'
      : cat.phase > 0.44 && cat.phase < 0.48 ? 'collected' : null;
    if (!flight) continue;
    assert.ok(cat.pose.suspension, `${flight} suspension is exposed by the rig`);
    assert.ok(cat.legs.every(leg => !leg.stance), `${flight} suspension releases all four contacts`);
    for (const leg of cat.legs) {
      assert.ok(leg.paw.y < flat(leg.paw.x) - 1.5 * cat.size - 0.05, `${flight}: ${leg.name} clears the ground`);
    }
    seen[flight] += 1;
  }
  assert.ok(seen.extended > 4 && seen.collected > 4, 'both suspension phases occur repeatedly');
  assert.ok(maxLength - minLength > 8, 'the whole running torso extends and collects');
});

test('running left and right mirror the same articulated anatomy', () => {
  const right = new Cat({ terrain: flat });
  const left = new Cat({ terrain: flat });
  advance(right, 3, { direction: 1, run: true });
  advance(left, 3, { direction: -1, run: true });
  for (let i = 0; i < 360; i += 1) {
    right.update(DT, { direction: 1, run: true });
    left.update(DT, { direction: -1, run: true });
    close(right.x, -left.x, 1e-8, 'mirrored physical travel');
    close(right.phase, left.phase, 1e-8, 'matching phase in either direction');
    for (const node of ['hip', 'shoulder', 'head', 'neck']) {
      close(right.pose[node].x, left.pose[node].x, 0.03, `${node}: matching normalized X`);
      close(right.pose[node].y, left.pose[node].y, 0.03, `${node}: matching normalized Y`);
    }
    right.legs.forEach((leg, index) => {
      const counterpart = left.legs[index];
      assert.equal(leg.stance, counterpart.stance, 'the same paw is supported at either facing');
      close(leg.paw.x, -counterpart.paw.x, 0.03, `${leg.name}: mirrored world paw`);
      close(leg.paw.y, counterpart.paw.y, 0.03, `${leg.name}: same world paw height`);
      for (const node of ['root', 'joint', 'ankle', 'paw']) {
        close(leg.pose[node].x, counterpart.pose[node].x, 0.03, `${leg.name}: matching ${node} X`);
        close(leg.pose[node].y, counterpart.pose[node].y, 0.03, `${leg.name}: matching ${node} Y`);
      }
    });
  }
});

test('jump landing plants the forepaws before the hind paws and preserves their anchors', () => {
  const cat = new Cat({ terrain: flat });
  cat.update(DT, { jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 180 && !cat.grounded; i += 1) cat.update(DT, { jumpHeld: i < 30 });
  assert.equal(cat.grounded, true, 'physical body reaches the landing plane');
  const fronts = cat.legs.filter(leg => leg.kind === 'front');
  const hinds = cat.legs.filter(leg => leg.kind === 'hind');
  assert.ok(fronts.every(leg => leg.stance), 'both forepaws receive the initial impact');
  assert.ok(hinds.every(leg => !leg.stance && leg.paw.y < flat(leg.paw.x) - 1.5 * cat.size - 1),
    'hind paws remain lifted at first forepaw contact');
  const anchors = fronts.map(leg => leg.paw.x);
  let elapsed = 0;
  for (let i = 0; i < 12 && !hinds.every(leg => leg.stance); i += 1) {
    cat.update(DT, {}); elapsed += DT;
    fronts.forEach((leg, index) => {
      assert.equal(leg.stance, true, 'forepaw support survives the rear touchdown sequence');
      close(leg.paw.x, anchors[index], 1e-8, 'first impact remains anchored');
    });
    if (elapsed < .075 - 1e-12) assert.ok(hinds.every(leg => !leg.stance), 'rear touchdown is delayed');
  }
  assert.ok(hinds.every(leg => leg.stance), 'hind paws follow the forepaws');
  assert.ok(elapsed >= .075 - DT - 1e-12 && elapsed <= .075 + DT + 1e-12, 'rear touchdown follows after about seventy-five milliseconds');
  for (const leg of cat.legs) close(leg.paw.y, flat(leg.paw.x) - 1.5 * cat.size, 1e-8, 'all landed toes contact the scaled plane');
});

test('reference support starts and releases at exact phase boundaries after periodic wrapping', () => {
  for (const [name, [begin, end]] of Object.entries(GALLOP_CONTACT_WINDOWS)) {
    for (const period of [-3, 0, 4]) {
      assert.equal(sampleGallop(begin + period).legs[name].contact, true, `${name}: exact support begins in period ${period}`);
      assert.equal(sampleGallop(end + period).legs[name].contact, false, `${name}: exact support releases in period ${period}`);
    }
    assert.equal(sampleGallop(begin - 1e-7).legs[name].contact, false, `${name}: no premature touchdown`);
    assert.equal(sampleGallop(end - 1e-7).legs[name].contact, true, `${name}: support survives until release`);
  }
});

test('an idle cat keeps its torso, head and planted paws still while only the tail moves', () => {
  const cat = new Cat({ terrain: flat });
  advance(cat, .5);
  const { tail: initialTail, ...initialBody } = structuredClone(cat.pose);
  const initialFeet = cat.legs.map(leg => ({ paw: structuredClone(leg.paw), pose: structuredClone(leg.pose), stance: leg.stance }));
  let maxTailTravel = 0;
  for (let i = 0; i < 360; i += 1) {
    cat.update(DT, {});
    const { tail, ...body } = cat.pose;
    assert.deepEqual(body, initialBody, 'resting torso and head do not bob or change shape');
    cat.legs.forEach((leg, index) => {
      assert.deepEqual({ paw: leg.paw, pose: leg.pose, stance: leg.stance }, initialFeet[index], 'idle paws stay planted without stepping');
    });
    maxTailTravel = Math.max(maxTailTravel, distance(tail.at(-1), initialTail.at(-1)));
  }
  assert.ok(maxTailTravel > .1, 'the tail remains a visible living motion');
});

test('observed walking keeps ground support and wraps its limbs continuously', () => {
  for (let i = 0; i <= 1800; i += 1) {
    const pose = sampleWalk(i / 1800);
    assert.ok(numericValues(pose).every(Number.isFinite), 'walking landmarks remain finite');
    const supports = Object.values(pose.legs).filter(leg => leg.contact);
    assert.ok(supports.length >= 2 && supports.length <= 3, 'walking always has two or three grounded paws');
    for (const leg of supports) close(leg.y, 44 + pose.bodyLift, 1e-8, 'walking support uses the shared ground plane');
  }
  const before = numericValues(sampleWalk(-1e-5)), after = numericValues(sampleWalk(1e-5));
  before.forEach((value, index) => close(value, after[index], .02, 'the walking cycle has no seam teleport'));
  assert.deepEqual(sampleWalk(-.25), sampleWalk(.75), 'negative walking phases wrap periodically');
});

test('the braking sequence braces its forepaws, crouches, and recovers without looping', () => {
  const initial = sampleBrake(0), crouched = sampleBrake(1 / 3), standing = sampleBrake(1);
  assert.ok(crouched.shoulder.y > initial.shoulder.y + 6, 'the chest absorbs forward momentum');
  assert.ok(crouched.head.y > standing.head.y + 10, 'the head lowers during braking and recovers to standing');
  assert.deepEqual(sampleBrake(-1), initial, 'negative braking progress holds its first pose');
  assert.deepEqual(sampleBrake(2), standing, 'finished braking holds its standing endpoint');
  for (let i = 0; i <= 600; i += 1) {
    const pose = sampleBrake(i / 600);
    assert.ok(numericValues(pose).every(Number.isFinite));
    assert.ok(pose.legs.frontFar.contact && pose.legs.frontNear.contact, 'forepaws brace throughout the stop');
    for (const leg of Object.values(pose.legs)) {
      assert.ok(leg.y <= 44 + pose.bodyLift + 1e-8, 'a braking target never penetrates the ground');
    }
  }
});

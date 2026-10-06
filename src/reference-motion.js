/**
 * A reconstructed feline transverse gallop, guided by the supplied 24-panel
 * side-view photographic study. The first twelve panels describe one stride;
 * the remaining panels repeat its extension / fore support / collection /
 * hind support sequence. These are manually observed joint and paw landmarks,
 * not extracted photographs or a generic sine-wave limb animation.
 *
 * Coordinates use the unscaled cat model: forward is +X, down is +Y. The visual
 * torso origin rises by `bodyLift` relative to the physics body. A supported paw
 * therefore has local Y = 44 + bodyLift. Contact positions must be anchored in
 * world space by the physical rig, rather than following this local trajectory.
 */

const LEG_NAMES = ['hindNear', 'hindFar', 'frontNear', 'frontFar'];
const SUPPORT_HEIGHT = 44;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = phase => {
  const remainder = phase % 1;
  return remainder < 0 ? remainder + 1 : remainder;
};

// Half-open intervals. The two genuinely airborne intervals are the gathered
// suspension [5/12, 6/12) and the extended suspension [9/12, 1) U [0, 2/12).
export const GALLOP_CONTACT_WINDOWS = Object.freeze({
  frontFar: Object.freeze([2 / 12, 4 / 12]),
  frontNear: Object.freeze([3 / 12, 5 / 12]),
  hindFar: Object.freeze([6 / 12, 8 / 12]),
  hindNear: Object.freeze([7 / 12, 9 / 12]),
});

const landmark = (x, y) => Object.freeze({ x, y });
const paw = (x, y, contact = false) => Object.freeze({ x, y, contact });
const pose = (hip, shoulder, head, spineArch, bodyLift, tailAngle, legs) =>
  Object.freeze({
    hip: landmark(...hip),
    shoulder: landmark(...shoulder),
    head: landmark(...head),
    spineArch,
    bodyLift,
    tailAngle,
    legs: Object.freeze(Object.fromEntries(LEG_NAMES.map((name, index) => [name, paw(...legs[index])]))),
  });

// Paw arrays always follow hindNear, hindFar, frontNear, frontFar. The slight
// delay between the left and right limbs is observed in the reference: the cat
// never lands all four paws together, and the forelegs leave before hind support.
export const GALLOP_FRAMES = Object.freeze([
  // 01: elongated airborne silhouette; rear feet trail the pelvis.
  pose([-26, -3], [24, -1], [51, 0], 0.6, 5, -2.98, [
    [-54, 27], [-48, 22], [55, 25], [51, 21],
  ]),
  // 02: leading forepaw reaches down while the rear knees begin recovering.
  pose([-26, -3], [24, 5], [51, 0], 0.9, 2.5, -2.93, [
    [-52, 28], [-43, 23], [51, 35], [47, 39],
  ]),
  // 03: first forepaw impact; the second forepaw remains just off the ground.
  pose([-24, -2], [23, 8], [50, 1], 1.8, 0.8, -2.90, [
    [-42, 23], [-29, 21], [47, 41], [42, 44.8, true],
  ]),
  // 04: staggered fore support absorbs the landing while rear feet sweep in.
  pose([-23, -3], [22, 9], [49, 2], 3.8, 0, -2.82, [
    [-26, 22], [-11, 24], [39, 44, true], [27, 44, true],
  ]),
  // 05: the near forepaw passes under the chest; the far forepaw lifts next.
  pose([-21, -4], [21, 8], [48, 2], 6.8, 0, -2.70, [
    [-9, 28], [4, 36], [24, 44, true], [12, 44],
  ]),
  // 06: gathered suspension. Flexion shortens the trunk as all feet tuck in.
  pose([-18, -6], [20, 8], [46, 1], 9.4, 4, -2.56, [
    [10, 39], [4, 44], [9, 48], [16, 27],
  ]),
  // 07: first hind landing, pelvis high and both forelegs folded underneath.
  pose([-17, -5], [20, 7], [45, 1], 10, 1, -2.52, [
    [6, 42], [1, 45, true], [18, 28], [22, 23],
  ]),
  // 08: staggered hind support; the pelvis unfolds to drive the next bound.
  pose([-20, -3], [21, 4], [46, 1], 7.2, 2, -2.55, [
    [-13, 46, true], [-14, 46, true], [32, 18], [38, 21],
  ]),
  // 09: final rear push, far hindpaw released, chest opening forward.
  pose([-25, 0], [23, 1], [48, 0], 3.2, 5, -2.63, [
    [-28, 49, true], [-29, 49], [43, 15], [47, 19],
  ]),
  // 10: hind toe-off. The outgoing toe starts at ground height for continuity.
  pose([-27, -2], [25, -1], [50, 0], 0.5, 8, -2.78, [
    [-43, 52], [-47, 25], [53, 18], [55, 22],
  ]),
  // 11: fully extended suspension, spine long and head close to its axis.
  pose([-27, -3], [25, -1], [52, 0], 0, 8, -2.91, [
    [-55, 32], [-51, 20], [56, 21], [51, 25],
  ]),
  // 12: the forelegs begin their next reach as the rear feet finish trailing.
  pose([-26, -3], [24, -1], [51, 0], 0.3, 6, -2.98, [
    [-55, 25], [-48, 20], [57, 23], [52, 26],
  ]),
]);

const catmullRom = (previous, current, next, following, t) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * current
    + (-previous + next) * t
    + (2 * previous - 5 * current + 4 * next - following) * t2
    + (-previous + 3 * current - 3 * next + following) * t3
  );
};

/** Return an independent, smoothly interpolated pose for any periodic phase. */
export function sampleGallop(phase = 0) {
  const wrapped = wrap(Number.isFinite(phase) ? phase : 0);
  // Floating-point modulo can put an exact contact boundary just below itself
  // after adding an integer stride. Snap only machine-close observed frames.
  const grid = Math.round(wrapped * GALLOP_FRAMES.length) / GALLOP_FRAMES.length;
  const normalized = Math.abs(wrapped - grid) < 1e-12 ? wrap(grid) : wrapped;
  const position = normalized * GALLOP_FRAMES.length;
  const index = Math.floor(position);
  const fraction = position - index;
  const count = GALLOP_FRAMES.length;
  const frames = [-1, 0, 1, 2].map(offset => GALLOP_FRAMES[(index + offset + count) % count]);
  const interpolate = read => catmullRom(...frames.map(read), fraction);
  const samplePoint = name => ({
    x: interpolate(frame => frame[name].x),
    y: interpolate(frame => frame[name].y),
  });
  const bodyLift = clamp(interpolate(frame => frame.bodyLift), 0, 8);
  const ground = SUPPORT_HEIGHT + bodyLift;
  const legs = {};
  for (const name of LEG_NAMES) {
    const [begin, end] = GALLOP_CONTACT_WINDOWS[name];
    const contact = normalized >= begin && normalized < end;
    legs[name] = {
      x: interpolate(frame => frame.legs[name].x),
      // Contact must remain exact. A spline can otherwise overshoot the ground
      // between two supported frames; airborne feet also stay above that plane.
      y: contact ? ground : Math.min(ground, interpolate(frame => frame.legs[name].y)),
      contact,
    };
  }
  return {
    hip: samplePoint('hip'),
    shoulder: samplePoint('shoulder'),
    head: samplePoint('head'),
    spineArch: clamp(interpolate(frame => frame.spineArch), 0, 10),
    bodyLift,
    tailAngle: interpolate(frame => frame.tailAngle),
    legs,
  };
}

/**
 * Four-beat walking landmarks following the supplied WALK strip. Unlike the
 * running study, the back remains nearly level, the head is carried above the
 * shoulders, and at least two feet support the body throughout the stride.
 * Contacts proceed hind-far, front-far, hind-near, front-near.
 */
export const WALK_CONTACT_WINDOWS = Object.freeze({
  hindFar: Object.freeze([Object.freeze([0, 5 / 8])]),
  frontFar: Object.freeze([Object.freeze([2 / 8, 7 / 8])]),
  hindNear: Object.freeze([Object.freeze([0, 1 / 8]), Object.freeze([4 / 8, 1])]),
  frontNear: Object.freeze([Object.freeze([0, 3 / 8]), Object.freeze([6 / 8, 1])]),
});

// Forty-eight model units per stride keep supported toes moving rearward by
// six local units per observed frame; the physical rig fixes those toes in the
// world and therefore owns the actual travel and terrain adaptation.
export const WALK_FRAMES = Object.freeze([
  pose([-28, 4], [25, 4], [49, -8], 1, 0.3, -2.05, [
    [-35, 44.3, true], [-14, 44.3, true], [30, 44.3, true], [14, 33],
  ]),
  pose([-28.5, 4.5], [24.5, 3.5], [48.5, -8.2], 1.2, 0.6, -2.03, [
    [-41, 44.6], [-20, 44.6, true], [24, 44.6, true], [27, 33],
  ]),
  pose([-28, 4], [25, 4], [49, -8], 1, 0.3, -2.07, [
    [-34, 33], [-26, 44.3, true], [18, 44.3, true], [38, 44.3, true],
  ]),
  pose([-27.5, 3.5], [25.5, 4.5], [49.5, -7.8], 0.8, 0, -2.11, [
    [-21, 33], [-32, 44, true], [12, 44], [32, 44, true],
  ]),
  pose([-28, 4], [25, 4], [49, -8], 1, 0.3, -2.08, [
    [-11, 44.3, true], [-38, 44.3, true], [18, 33], [26, 44.3, true],
  ]),
  pose([-28.5, 4.5], [24.5, 3.5], [48.5, -8.2], 1.2, 0.6, -2.03, [
    [-17, 44.6, true], [-44, 44.6], [31, 33], [20, 44.6, true],
  ]),
  pose([-28, 4], [25, 4], [49, -8], 1, 0.3, -2.02, [
    [-23, 44.3, true], [-38, 33], [42, 44.3, true], [14, 44.3, true],
  ]),
  pose([-27.5, 3.5], [25.5, 4.5], [49.5, -7.8], 0.8, 0, -2.06, [
    [-29, 44, true], [-24, 33], [36, 44, true], [8, 44],
  ]),
]);

/**
 * A single braking action following the ten observed BRAKE stages: forelegs
 * brace, weight moves down and forward, the rear legs gather, then the chest
 * and head recover to standing. Progress is physical stopping progress, not a
 * looping stride. These local targets never replace a valid world-space anchor.
 */
export const BRAKE_FRAMES = Object.freeze([
  pose([-25, 0], [24, 3], [50, -1], 2, 0, -2.95, [
    [-40, 31], [-36, 35], [47, 44, true], [43, 44, true],
  ]),
  pose([-24, -1], [23, 7], [49, 3], 4, 0, -2.76, [
    [-34, 31], [-27, 38], [46, 44, true], [42, 44, true],
  ]),
  pose([-22, 0], [22, 11], [47, 7], 5.5, 0, -2.45, [
    [-23, 38], [-18, 44, true], [44, 44, true], [40, 44, true],
  ]),
  pose([-21, 2], [22, 12], [46, 8], 6, 0, -2.23, [
    [-14, 44, true], [-19, 44, true], [41, 44, true], [37, 44, true],
  ]),
  pose([-22, 4], [23, 10], [47, 6], 5, 0, -2.10, [
    [-17, 44, true], [-22, 44, true], [38, 44, true], [34, 44, true],
  ]),
  pose([-24, 5], [24, 8], [48, 3], 4, 0, -2.16, [
    [-20, 44, true], [-24, 44, true], [35, 44, true], [31, 44, true],
  ]),
  pose([-26, 4.5], [25, 6], [49, -1], 2.8, 0, -2.28, [
    [-22, 44, true], [-26, 44, true], [33, 44, true], [29, 44, true],
  ]),
  pose([-27.5, 4], [25, 4.5], [50, -4], 1.5, 0, -2.45, [
    [-24, 44, true], [-27.5, 44, true], [31, 44, true], [27, 44, true],
  ]),
  pose([-28, 4], [25, 4], [51, -7], 0.7, 0, -2.60, [
    [-25, 44, true], [-28, 44, true], [30, 44, true], [26, 44, true],
  ]),
  pose([-28, 4], [25, 4], [51, -8], 0.6, 0, -2.70, [
    [-25, 44, true], [-28, 44, true], [29, 44, true], [25, 44, true],
  ]),
]);

// Share the shape interpolation without changing the already validated gallop
// timing. Clamped endpoint neighbours give braking a continuous, non-looping
// trajectory; wrapped neighbours give the walk a smooth periodic trajectory.
function sampleObservedFrames(keyframes, progress, periodic, contactAt) {
  const count = keyframes.length;
  const scaled = progress * (periodic ? count : count - 1);
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const neighbours = [-1, 0, 1, 2].map(offset => keyframes[periodic
    ? (index + offset + count) % count
    : clamp(index + offset, 0, count - 1)]);
  const interpolate = read => catmullRom(...neighbours.map(read), fraction);
  const samplePoint = name => ({
    x: interpolate(frame => frame[name].x),
    y: interpolate(frame => frame[name].y),
  });
  const bodyLift = clamp(interpolate(frame => frame.bodyLift), 0, 1);
  const ground = SUPPORT_HEIGHT + bodyLift;
  const legs = {};
  for (const name of LEG_NAMES) {
    const contact = contactAt(name, progress);
    legs[name] = {
      x: interpolate(frame => frame.legs[name].x),
      y: contact ? ground : Math.min(ground, interpolate(frame => frame.legs[name].y)),
      contact,
    };
  }
  return {
    hip: samplePoint('hip'),
    shoulder: samplePoint('shoulder'),
    head: samplePoint('head'),
    spineArch: clamp(interpolate(frame => frame.spineArch), 0, 10),
    bodyLift,
    tailAngle: interpolate(frame => frame.tailAngle),
    legs,
  };
}

/** Smooth, periodic four-beat walking pose; its contact count is always 2–3. */
export function sampleWalk(phase = 0) {
  const wrapped = wrap(Number.isFinite(phase) ? phase : 0);
  const grid = Math.round(wrapped * WALK_FRAMES.length) / WALK_FRAMES.length;
  const normalized = Math.abs(wrapped - grid) < 1e-12 ? wrap(grid) : wrapped;
  return sampleObservedFrames(WALK_FRAMES, normalized, true, (name, position) =>
    WALK_CONTACT_WINDOWS[name].some(([begin, end]) => position >= begin && position < end));
}

/** Smooth, one-shot braking pose. Progress outside [0, 1] holds its endpoint. */
export function sampleBrake(progress = 0) {
  const bounded = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const grid = Math.round(bounded * (BRAKE_FRAMES.length - 1)) / (BRAKE_FRAMES.length - 1);
  const normalized = Math.abs(bounded - grid) < 1e-12 ? grid : bounded;
  return sampleObservedFrames(BRAKE_FRAMES, normalized, false, (name, position) =>
    name.startsWith('front') || position >= (name === 'hindFar' ? 2 / 9 : 3 / 9));
}

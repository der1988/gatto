import { drawCat } from './cat-renderer.js';
import { sampleGallop, sampleWalk, sampleBrake } from './reference-motion.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (value, target, amount) => value < target
  ? Math.min(value + amount, target) : Math.max(value - amount, target);
const smooth = value => value * value * (3 - 2 * value);
const cubic = (a, b, c, d, t) => (1 - t) ** 3 * a
  + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
const wrap = value => ((value % 1) + 1) % 1;
const point = (x, y) => ({ x, y });

// Physics is measured in world pixels. The photographic rig is in anatomical
// model units, scaled once into the world; no bone changes length with its gait.
export class Cat {
  constructor({ x = 0, terrain = () => 0 } = {}) {
    this.size = 0.60;
    this.supportHeight = 44 * this.size;
    this.terrain = terrain;
    this.reset(x, terrain);
  }

  reset(x = 0, terrain = this.terrain) {
    this.terrain = terrain || (() => 0);
    const bounds = this.terrain.bounds;
    this.x = bounds ? clamp(x, bounds.min + 45 * this.size, bounds.max - 45 * this.size) : x;
    const initialPlatform = (this.terrain.platforms || []).filter(platform => this.x >= platform.x1 && this.x <= platform.x2)
      .sort((a, b) => a.y - b.y)[0];
    this.platformId = initialPlatform?.id || null;
    this.supportY = initialPlatform ? initialPlatform.y : this._floorHeight();
    this.y = this.supportY - this.supportHeight;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.grounded = true;
    this.jumpCount = 0;
    this.phase = 0;
    this.time = 0;
    this.gait = 'riposo';
    this._speed = 0;
    this._acceleration = 0;
    this._effort = 0;
    this._pitch = 0;
    this._motionPitch = 0;
    this._squash = 0;
    this._rigDrop = 0;
    this._squashVelocity = 0;
    this._jumpBuffer = 0;
    this._coyote = 0.1;
    this._jumpTime = 0;
    this._jumpCut = false;
    this._landing = 0;
    this._landingAge = 100;
    this._gallopBlend = 0;
    this._brakeBlend = 0;
    this._brakeProgress = 1;
    this.braking = false;
    this._idleFrozen = false;
    this._reference = sampleGallop(0);
    this._walkReference = sampleWalk(0);
    this._brakeReference = sampleBrake(1);
    this._tail = Array.from({ length: 9 }, (_, i) => ({ angle: -2.7 + i * 0.14, velocity: 0 }));
    this.legs = [
      { key: 'hindFar', name: 'posteriore lontana', kind: 'hind', far: true, rootX: -30, offset: 0.25 },
      { key: 'frontFar', name: 'anteriore lontana', kind: 'front', far: true, rootX: 22, offset: 0.5 },
      { key: 'hindNear', name: 'posteriore vicina', kind: 'hind', far: false, rootX: -27, offset: 0.75 },
      { key: 'frontNear', name: 'anteriore vicina', kind: 'front', far: false, rootX: 26, offset: 0 },
    ];
    this._resetFeet();
    this._updatePose();
  }

  _platform() { return (this.terrain.platforms || []).find(platform => platform.id === this.platformId); }
  _surfaceAt(x) {
    const platform = this._platform();
    return platform && x >= platform.x1 && x <= platform.x2 ? platform.y : this.terrain(x);
  }
  _contactY(x) { return this._surfaceAt(x) - 1.5 * this.size; }
  _modelX(worldX) { return (worldX - this.x) * this.facing / this.size; }
  _modelY(worldY) { return (worldY - this.y) / this.size; }
  _worldX(modelX) { return this.x + this.facing * modelX * this.size; }
  _worldY(modelY) { return this.y + modelY * this.size; }

  _resetFeet() {
    for (const leg of this.legs) {
      const x = this._safeFootX(this._worldX(leg.rootX + 3));
      leg.paw = { x, y: this._contactY(x) };
      leg.from = { ...leg.paw };
      leg.to = { ...leg.paw };
      leg.stance = true;
      leg.swingProgress = 0;
      leg.forcedSwing = false;
      leg.settling = null;
      leg.airPaw = null;
      leg.toeAngle = Math.atan2(8, 7);
    }
  }

  update(dt, input = {}, terrain = this.terrain) {
    dt = clamp(dt, 0, 1 / 30);
    if (!dt) return;
    this.terrain = terrain || this.terrain;
    this.time += dt;
    this._landingAge += dt;
    const direction = clamp(input.direction || 0, -1, 1);
    const oldVx = this.vx;
    const previousX = this.x;
    const previousFeetY = this.y + this.supportHeight;
    const wasBraking = this.braking;
    this.braking = this.grounded && Math.abs(oldVx) > 8
      && (!direction || direction * oldVx < -8);
    if (this.braking && !wasBraking) this._brakeProgress = 0;
    this._brakeProgress = Math.min(1, this._brakeProgress + dt / 0.26);
    this._brakeBlend = lerp(this._brakeBlend, this.braking ? 1 : 0, 1 - Math.exp(-dt * (this.braking ? 22 : 13)));
    this._brakeReference = sampleBrake(this._brakeProgress);
    const maximumSpeed = input.run ? 310 : 138;
    if (this.grounded) {
      this._coyote = 0.1;
      if (direction) {
        const reversing = direction * this.vx < -5;
        this.vx = approach(this.vx, direction * maximumSpeed,
          (reversing ? 1400 : input.run ? 760 : 590) * dt);
      } else {
        this.vx = approach(this.vx, 0, 1200 * dt);
      }
    } else {
      this._coyote = Math.max(0, this._coyote - dt);
      if (direction && (Math.sign(this.vx) !== direction || Math.abs(this.vx) < maximumSpeed)) {
        this.vx = approach(this.vx, direction * maximumSpeed, 230 * dt);
      }
      this.vx *= Math.exp(-0.08 * dt);
    }
    this._acceleration = (this.vx - oldVx) / dt;
    this._effort = lerp(this._effort, clamp(Math.abs(this._acceleration) / 760 + Math.abs(this.vx) / 620, 0, 1), 1 - Math.exp(-dt * 5));
    this.x += this.vx * dt;
    this._collideHorizontal(previousX);
    const newFacing = Math.abs(this.vx) > 16 ? Math.sign(this.vx)
      : Math.abs(this.vx) < 4 && direction ? direction : this.facing;
    if (newFacing !== this.facing) {
      this.facing = newFacing;
      if (this.grounded) {
        // A quick turn transfers weight through a recovery step. Preserve the
        // stride clock so changing direction does not restart the animation.
        this._resetFeet();
      }
      else for (const leg of this.legs) {
        leg.paw = { x: this._worldX(leg.rootX + 3), y: this._worldY(30) };
        leg.airPaw = null;
      }
    }
    this._jumpBuffer = input.jumpPressed ? 0.13 : Math.max(0, this._jumpBuffer - dt);
    if (this._jumpBuffer > 0 && (this.grounded || this._coyote > 0)) {
      this.vy = -390;
      this.grounded = false;
      this.platformId = null;
      this._coyote = 0;
      this._jumpBuffer = 0;
      this._jumpTime = 0;
      this._jumpCut = false;
      this._squashVelocity = 15;
      this.jumpCount += 1;
    }
    const platform = this._platform();
    if (this.grounded && platform && !this._overlapsPlatform(this.x, platform)) {
      this.grounded = false;
      this.platformId = null;
      this._jumpTime = 0;
      this._coyote = 0.1;
    }
    this.supportY = this._groundHeight();
    const groundY = this.supportY - this.supportHeight;
    if (!this.grounded) {
      this._jumpTime += dt;
      if (!input.jumpHeld && this.vy < -240 && !this._jumpCut) {
        this.vy = -240;
        this._jumpCut = true;
      }
      const holdLift = input.jumpHeld && this.vy < 0 && this._jumpTime < 0.19;
      this.vy += (holdLift ? 790 : 1080) * dt;
      this.y += this.vy * dt;
      const ceiling = this.terrain.bounds?.ceiling;
      if (Number.isFinite(ceiling) && this.y - 15 * this.size < ceiling) {
        this.y = ceiling + 15 * this.size;
        this.vy = Math.max(0, this.vy);
      }
      if (this.vy >= 0) {
        const nextFeetY = this.y + this.supportHeight;
        const candidates = [{ y: this._floorHeight(), id: null }, ...(this.terrain.platforms || [])
          .filter(candidate => this._overlapsPlatform(this.x, candidate))]
          .filter(candidate => previousFeetY <= candidate.y + 0.6 && nextFeetY >= candidate.y)
          .sort((a, b) => a.y - b.y);
        if (candidates.length) this._land(candidates[0]);
      }
    } else {
      this.y = groundY;
      this.vy = 0;
      this._jumpTime = 0;
    }
    this._squashVelocity += (-this._squash * 190 - this._squashVelocity * 17) * dt;
    this._squash += this._squashVelocity * dt;
    this._squash = clamp(this._squash, -2.2, 4.8);
    this._landing *= Math.exp(-dt * 7);
    this._speed = Math.abs(this.vx);
    this.gait = !this.grounded ? 'salto' : this._speed < 8 ? 'riposo'
      : this._speed < 160 ? 'passo' : this._speed < 245 ? 'trotto' : 'galoppo';
    const terrainPitch = this.grounded
      ? clamp((this.terrain(this.x + this.facing * 28 * this.size) - this.terrain(this.x - this.facing * 28 * this.size)) / (56 * this.size), -0.3, 0.3) : 0;
    const pitchTarget = clamp(this._acceleration * this.facing / 22000, -0.045, 0.045)
      + (this.grounded ? 0 : clamp(this.vy / 4200, -0.07, 0.07));
    this._motionPitch = lerp(this._motionPitch, pitchTarget, 1 - Math.exp(-dt * 8));
    this._pitch = terrainPitch + this._motionPitch;
    const desiredGallop = smooth(clamp((this._speed - 180) / 80, 0, 1));
    this._gallopBlend = lerp(this._gallopBlend, desiredGallop, 1 - Math.exp(-dt * 13));
    const stride = lerp(83, 150, this._gallopBlend) * this.size;
    this.phase = wrap(this.phase + this._speed / stride * dt);
    this._reference = sampleGallop(this.phase);
    this._walkReference = sampleWalk(this.phase);
    this._updateFeet(dt);
    this._updateTail(dt);
    const idle = this.grounded && this._speed < 0.5 && this._landingAge > 0.35
      && this._brakeBlend < 0.01 && this._gallopBlend < 0.01
      && this.legs.every(leg => leg.stance && !leg.settling);
    if (!idle) this._idleFrozen = false;
    this._updatePose();
    if (idle) this._idleFrozen = true;
  }

  _floorHeight() {
    return (this.terrain(this.x - 24 * this.size) + this.terrain(this.x + 24 * this.size)) * 0.5;
  }
  _groundHeight() {
    const platform = this._platform();
    return platform ? platform.y : this._floorHeight();
  }

  _overlapsPlatform(x, platform) {
    const halfWidth = 20 * this.size;
    return x + halfWidth > platform.x1 && x - halfWidth < platform.x2;
  }

  _collideHorizontal(previousX) {
    const halfWidth = 20 * this.size;
    const feetY = this.y + this.supportHeight;
    for (const platform of this.terrain.platforms || []) {
      if (!platform.solid || platform.id === this.platformId || feetY <= platform.y + 0.1) continue;
      if (!this._overlapsPlatform(this.x, platform)) continue;
      // Furniture fills the volume between its top and the room floor. Entering
      // from the side requires the feet to have cleared that top during a jump.
      if (previousX <= platform.x1 - halfWidth + 0.1) this.x = platform.x1 - halfWidth;
      else if (previousX >= platform.x2 + halfWidth - 0.1) this.x = platform.x2 + halfWidth;
      else this.x = previousX < (platform.x1 + platform.x2) / 2 ? platform.x1 - halfWidth : platform.x2 + halfWidth;
      this.vx = 0;
    }
    const bounds = this.terrain.bounds;
    if (bounds) {
      const boundedX = clamp(this.x, bounds.min + 45 * this.size, bounds.max - 45 * this.size);
      if (boundedX !== this.x) { this.x = boundedX; this.vx = 0; }
    }
  }

  _land(surface) {
    const impact = this.vy;
    this.supportY = surface.y;
    this.platformId = surface.id || null;
    this.y = this.supportY - this.supportHeight;
    this.vy = 0;
    this.grounded = true;
    this._landingAge = 0;
    this._landing = clamp(impact / 440, 0, 1);
    this._squashVelocity += Math.min(impact * 0.075, 32);
    for (const leg of this.legs) {
      const footX = this._safeFootX(this._worldX(leg.rootX + 3) + this.vx * 0.012);
      leg.paw = { x: footX, y: this._contactY(footX) };
      leg.stance = leg.kind === 'front';
      leg.airPaw = null;
    }
  }

  _safeFootX(x) {
    const platform = this._platform();
    if (platform) return clamp(x, platform.x1 + 1.5 * this.size, platform.x2 - 1.5 * this.size);
    for (const solid of this.terrain.platforms || []) {
      if (!solid.solid || x < solid.x1 || x > solid.x2) continue;
      x = this.x < (solid.x1 + solid.x2) / 2 ? solid.x1 - this.size : solid.x2 + this.size;
    }
    return x;
  }

  _updateAirFoot(leg, dt) {
    const rising = clamp(-this.vy / 390, 0, 1);
    const falling = clamp(this.vy / 370, 0, 1);
    const tuck = smooth(1 - clamp(Math.abs(this.vy) / 165, 0, 1));
    const thrust = 1 - clamp(this._jumpTime / 0.085, 0, 1);
    const front = leg.kind === 'front';
    let localX = front ? lerp(45, 28, tuck) : lerp(-42, -18, tuck);
    let localY = front ? lerp(23, 17, tuck) : lerp(31, 19, tuck);
    if (falling > 0) {
      localX = front ? lerp(28, 40, falling) : lerp(-18, -28, falling);
      localY = front ? lerp(17, 42, falling) : lerp(19, 36, falling);
    }
    if (!front) {
      localX -= thrust * 6;
      localY += thrust * 9;
    } else {
      localX += rising * 3;
    }
    localX += leg.far ? front ? -2 : 2 : 0;
    if (!leg.airPaw) leg.airPaw = { x: this._modelX(leg.paw.x), y: this._modelY(leg.paw.y) };
    const blend = 1 - Math.exp(-dt * 23);
    leg.airPaw.x = lerp(leg.airPaw.x, localX, blend);
    leg.airPaw.y = lerp(leg.airPaw.y, localY, blend);
    leg.paw = { x: this._worldX(leg.airPaw.x), y: this._worldY(leg.airPaw.y) };
    leg.stance = false;
    leg.forcedSwing = false;
    leg.settling = null;
  }

  _updateFeet(dt) {
    for (const leg of this.legs) {
      if (!this.grounded) { this._updateAirFoot(leg, dt); continue; }
      leg.airPaw = null;
      if (this._landingAge < 0.10) {
        if (leg.kind === 'front') {
          leg.paw.y = this._contactY(leg.paw.x);
          leg.stance = true;
        } else {
          const p = smooth(clamp(this._landingAge / 0.075, 0, 1));
          const x = this._worldX(leg.rootX + 3);
          if (!leg.stance) leg.paw = { x, y: this._contactY(x) - (1 - p) * 11 * this.size };
          if (p === 1) { leg.stance = true; leg.paw.y = this._contactY(leg.paw.x); }
        }
        continue;
      }
      if (this._speed < 8 || leg.settling) { this._settleFoot(leg, dt); continue; }
      if (this._gallopBlend > 0.5) { this._referenceFoot(leg, dt); continue; }
      this._walkFoot(leg, dt);
    }
  }

  _settleFoot(leg, dt) {
    const relativeX = this._modelX(leg.paw.x) - leg.rootX;
    if (!leg.settling && (Math.abs(relativeX) > 18 || !leg.stance)) {
      const x = this._safeFootX(this._worldX(leg.rootX + 3));
      leg.settling = { from: { ...leg.paw }, to: { x, y: this._contactY(x) }, progress: 0 };
    }
    if (leg.settling) {
      const step = leg.settling;
      step.progress = Math.min(1, step.progress + dt / 0.17);
      const eased = smooth(step.progress);
      leg.paw = { x: lerp(step.from.x, step.to.x, eased),
        y: lerp(step.from.y, step.to.y, eased) - Math.sin(step.progress * Math.PI) * 4 * this.size };
      leg.stance = false;
      if (step.progress === 1) {
        leg.settling = null;
        leg.stance = true;
        leg.offset = wrap(-this.phase);
      }
    } else { leg.paw.y = this._contactY(leg.paw.x); leg.stance = true; }
    leg.forcedSwing = false;
  }

  _referenceFoot(leg, dt) {
    const reference = this._reference.legs[leg.key];
    leg.forcedSwing = false;
    if (reference.contact) {
      if (!leg.stance) {
        const x = this._worldX(reference.x);
        leg.paw = { x, y: this._contactY(x) };
      }
      leg.stance = true;
      leg.paw.y = this._contactY(leg.paw.x);
    } else {
      const x = this._worldX(reference.x);
      const y = this._worldY(reference.y - this._reference.bodyLift);
      const blend = 1 - Math.exp(-dt * 42);
      const actualX = lerp(leg.paw.x, x, blend);
      leg.paw = { x: actualX,
        y: Math.min(this._contactY(actualX) - 0.35 * this.size, lerp(leg.paw.y, y, blend)) };
      leg.stance = false;
    }
    // Returning to a slower gait must initialize its next swing afresh.
    leg.fromLocal = this._modelX(leg.paw.x) - leg.rootX;
    leg.swingProgress = 0;
  }

  _walkFoot(leg, dt) {
    const trot = smooth(clamp((this._speed - 125) / 70, 0, 1));
    const stride = 83;
    const duty = lerp(0.68, 0.55, trot);
    const frequency = this._speed / (stride * this.size);
    const walkOffset = leg.kind === 'front' ? leg.far ? 0.5 : 0 : leg.far ? 0.25 : 0.75;
    const trotOffset = leg.kind === 'front' ? leg.far ? 0.5 : 0 : leg.far ? 0 : 0.5;
    const targetOffset = lerp(walkOffset, trotOffset, trot);
    let delta = targetOffset - leg.offset;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    leg.offset = wrap(leg.offset + delta * Math.min(1, dt * 7));
    let cycle = wrap(this.phase + leg.offset);
    const reach = stride * duty * 0.44;
    const relativeX = this._modelX(leg.paw.x) - leg.rootX;
    if (leg.stance && cycle < duty && relativeX < -reach - 3) {
      leg.forcedSwing = true;
      leg.forcedProgress = 0;
    }
    if (leg.forcedSwing) {
      leg.forcedProgress += frequency * dt / (1 - duty);
      if (leg.forcedProgress >= 1) {
        leg.forcedSwing = false;
        leg.offset = wrap(-this.phase);
        cycle = 0;
      } else cycle = duty + leg.forcedProgress * (1 - duty);
    }
    if (cycle >= duty) {
      const p = clamp((cycle - duty) / (1 - duty), 0, 1);
      if (leg.stance) {
        leg.fromLocal = this._modelX(leg.paw.x) - leg.rootX;
        leg.swingProgress = p;
        leg.stance = false;
      }
      const normalized = clamp((p - leg.swingProgress) / Math.max(0.08, 1 - leg.swingProgress), 0, 1);
      const travel = stride * (1 - duty) / 3;
      const relative = cubic(leg.fromLocal, leg.fromLocal - travel, reach + travel, reach, normalized);
      const x = this._worldX(leg.rootX + relative);
      leg.paw = { x, y: this._contactY(x) - Math.sin(normalized * Math.PI) * 12 * this.size };
      const landingX = this._worldX(leg.rootX + reach);
      leg.to = { x: landingX, y: this._contactY(landingX) };
    } else {
      if (!leg.stance) {
        // The previous gait may have stored its last landing far away. Compute
        // this touchdown from the current mass, never reuse a world-space goal.
        const x = this._worldX(leg.rootX + reach);
        leg.paw = { x, y: this._contactY(x) };
        leg.stance = true;
      }
      leg.paw.y = this._contactY(leg.paw.x);
    }
  }

  _updateTail(dt) {
    const running = this._gallopBlend;
    for (let i = 0; i < this._tail.length; i += 1) {
      const joint = this._tail[i];
      const idleAngle = -2.7 + i * 0.14;
      const tipCurl = smooth(clamp((i / 8 - 0.35) / 0.65, 0, 1)) * 0.85;
      const runAngle = this._reference.tailAngle + tipCurl
        + Math.sin(this.phase * TAU - i * 0.45) * (0.02 + i * 0.01);
      const inertial = clamp(-this._acceleration * this.facing / 15000, -0.08, 0.08) * (i + 1) / 9;
      const target = lerp(idleAngle, runAngle, running)
        + Math.sin(this.time * 1.7 - i * 0.3) * 0.025 + inertial
        + (!this.grounded ? Math.sin(this._jumpTime * 6 - i * 0.35) * 0.075 : 0);
      joint.velocity += ((target - joint.angle) * (95 - i * 4) - joint.velocity * 12) * dt;
      joint.angle += joint.velocity * dt;
    }
  }

  _updatePose() {
    if (this._idleFrozen && this.pose) {
      this._buildTail();
      return;
    }
    const blend = this.grounded ? this._gallopBlend : 0;
    const reference = this._reference;
    const walk = this._walkReference;
    const brake = this._brakeReference;
    const braking = this.grounded ? this._brakeBlend : 0;
    const movement = clamp(this._speed / 150, 0, 1);
    const jumpCrouch = !this.grounded ? (1 - clamp(this._jumpTime / 0.07, 0, 1)) * 3.2 : 0;
    const apexTuck = !this.grounded ? smooth(1 - clamp(Math.abs(this.vy) / 165, 0, 1)) : 0;
    const bodyLift = this.grounded ? lerp(walk.bodyLift * movement, reference.bodyLift, blend) * (1 - braking) : 0;
    const naturalBase = this._squash + jumpCrouch - bodyLift;
    const hipShape = point(lerp(lerp(-28, walk.hip.x, movement), reference.hip.x, blend),
      lerp(lerp(4, walk.hip.y, movement), reference.hip.y, blend));
    const shoulderShape = point(lerp(lerp(25, walk.shoulder.x, movement), reference.shoulder.x, blend),
      lerp(lerp(4, walk.shoulder.y, movement), reference.shoulder.y, blend));
    hipShape.x = lerp(hipShape.x, brake.hip.x, braking);
    hipShape.y = lerp(hipShape.y, brake.hip.y, braking);
    shoulderShape.x = lerp(shoulderShape.x, brake.shoulder.x, braking);
    shoulderShape.y = lerp(shoulderShape.y, brake.shoulder.y, braking);
    let necessaryDrop = 0;
    if (this.grounded) for (const leg of this.legs) {
      if (!leg.stance) continue;
      const front = leg.kind === 'front';
      const shape = front ? shoulderShape : hipShape;
      const rootX = shape.x + leg.rootX - (front ? 25 : -28);
      const rootY = naturalBase + shape.y + this._pitch * shape.x - (front ? 2 : 0) - (leg.far ? 1.5 : 0);
      const ankleX = this._modelX(leg.paw.x) - (front ? 1 : Math.cos(leg.toeAngle) * Math.hypot(7, 8));
      const ankleY = this._modelY(leg.paw.y) - (front ? 5 : Math.sin(leg.toeAngle) * Math.hypot(7, 8));
      const combinedReach = front ? 45.3 : 53.3;
      const allowedVertical = Math.sqrt(Math.max(1, combinedReach ** 2 - (ankleX - rootX) ** 2));
      necessaryDrop = Math.max(necessaryDrop, ankleY - rootY - allowedVertical);
    }
    this._rigDrop = Math.max(clamp(necessaryDrop, 0, 18), this._rigDrop * 0.92);
    const base = naturalBase + this._rigDrop;
    const hip = point(hipShape.x, base + hipShape.y + this._pitch * hipShape.x);
    const shoulder = point(shoulderShape.x, base + shoulderShape.y + this._pitch * shoulderShape.x);
    const headX = lerp(lerp(lerp(51, walk.head.x, movement), reference.head.x, blend), brake.head.x, braking);
    const headY = base + lerp(lerp(lerp(-8, walk.head.y, movement), reference.head.y, blend), brake.head.y, braking)
      + this._pitch * headX * (1 - blend * 0.6);
    const spineArch = lerp(lerp(walk.spineArch * movement, reference.spineArch, blend), brake.spineArch, braking) + apexTuck * 3.2;
    this.pose = {
      base, hip, shoulder, head: point(headX, headY),
      neck: point(lerp(38, (shoulder.x + headX) * 0.53, blend), lerp(base - 5, (shoulder.y + headY) * 0.5, blend)),
      spineArch, flex: spineArch, referenceBlend: blend, phase: this.phase,
      braking: this.braking, brakeBlend: braking,
      suspension: this.grounded && this._gallopBlend > 0.5 && this.legs.every(leg => !leg.stance),
      motionPhase: !this.grounded ? this.vy < -115 ? 'slancio' : this.vy > 115 ? 'atterraggio' : 'raccolto'
        : this.legs.every(leg => !leg.stance) ? 'sospensione' : 'appoggio',
      tail: [],
    };
    this._buildTail();
    for (const leg of this.legs) this._solveLeg(leg);
    this.pose.suspension = this.grounded && this._gallopBlend > 0.5 && this.legs.every(leg => !leg.stance);
  }

  _buildTail() {
    const hip = this.pose.hip;
    this.pose.tail = [point(hip.x - 8, hip.y - 6)];
    for (let i = 0; i < this._tail.length; i += 1) {
      const previous = this.pose.tail.at(-1);
      const length = 5.25 - i * 0.095;
      this.pose.tail.push(point(previous.x + Math.cos(this._tail[i].angle) * length,
        previous.y + Math.sin(this._tail[i].angle) * length));
    }
  }

  _solveLeg(leg) {
    const front = leg.kind === 'front';
    const root = { ...(front ? this.pose.shoulder : this.pose.hip) };
    root.x += leg.rootX - (front ? 25 : -28);
    root.y -= (front ? 2 : 0) + (leg.far ? 1.5 : 0);
    const paw = point(this._modelX(leg.paw.x), this._modelY(leg.paw.y));
    const stanceAngle = Math.atan2(8, 7);
    if (!front) {
      const trailing = !leg.stance ? smooth(clamp((root.x - paw.x - 5) / 20, 0, 1)) : 0;
      const desiredAngle = lerp(stanceAngle, Math.atan2(7, -8), trailing);
      leg.toeAngle = lerp(leg.toeAngle, desiredAngle, 0.28);
    }
    const ankle = point(paw.x - (front ? 1 : Math.cos(leg.toeAngle) * Math.hypot(7, 8)),
      paw.y - (front ? 5 : Math.sin(leg.toeAngle) * Math.hypot(7, 8)));
    const anatomicalReach = front ? 37.5 : 45.5;
    const reach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
    if (reach > anatomicalReach) {
      const glide = Math.min(8, reach - anatomicalReach);
      root.x += (ankle.x - root.x) / reach * glide;
      root.y += (ankle.y - root.y) / reach * glide;
    }
    let remainingReach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
    if (remainingReach < 2.05) {
      // Unequal upper/lower bones cannot fold into a zero-radius target. Keep
      // the small inner exclusion disk too, including during a braking tuck.
      const ux = remainingReach > 0.001 ? (ankle.x - root.x) / remainingReach : 0;
      const uy = remainingReach > 0.001 ? (ankle.y - root.y) / remainingReach : 1;
      if (leg.stance) {
        root.x = ankle.x - ux * 2.05;
        root.y = ankle.y - uy * 2.05;
      } else {
        const constrainedX = root.x + ux * 2.05;
        const constrainedY = root.y + uy * 2.05;
        paw.x += constrainedX - ankle.x;
        paw.y += constrainedY - ankle.y;
        ankle.x = constrainedX;
        ankle.y = constrainedY;
        leg.paw = { x: this._worldX(paw.x), y: this._worldY(paw.y) };
        if (leg.airPaw) leg.airPaw = { ...paw };
      }
      remainingReach = 2.05;
    }
    if (leg.stance && remainingReach > (front ? 37.9 : 45.9)) {
      // A handoff can inherit a paw behind the new, more extended torso. The
      // animal lifts that unsupported toe for a recovery step; stretching the
      // skeleton or dragging a planted contact would violate the constraint.
      leg.stance = false;
    }
    if (!leg.stance && remainingReach > anatomicalReach) {
      const ratio = anatomicalReach / remainingReach;
      const constrainedX = root.x + (ankle.x - root.x) * ratio;
      const constrainedY = root.y + (ankle.y - root.y) * ratio;
      paw.x += constrainedX - ankle.x;
      paw.y += constrainedY - ankle.y;
      ankle.x = constrainedX;
      ankle.y = constrainedY;
      leg.paw = { x: this._worldX(paw.x), y: this._worldY(paw.y) };
      if (leg.airPaw) leg.airPaw = { ...paw };
    }
    const joint = this._ik(root, ankle, front ? 18 : 22, front ? 20 : 24, front ? 1 : -1);
    leg.pose = { root, joint, ankle, paw, footAngle: front ? 0 : leg.toeAngle,
      footRotation: front ? 0 : leg.toeAngle - stanceAngle };
  }

  _ik(root, foot, upper, lower, bend) {
    const dx = foot.x - root.x;
    const dy = foot.y - root.y;
    const distance = clamp(Math.hypot(dx, dy), Math.abs(upper - lower) + 0.01, upper + lower - 0.05);
    const direction = Math.atan2(dy, dx);
    const angle = Math.acos(clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1));
    return point(root.x + Math.cos(direction + angle * bend) * upper,
      root.y + Math.sin(direction + angle * bend) * upper);
  }

  draw(ctx, options = {}) { drawCat(ctx, this, options); }

  getTelemetry() {
    return { speed: this._speed, grounded: this.grounded, gait: this.gait, effort: this._effort };
  }
}

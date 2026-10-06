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

// All distances are world pixels, velocities pixels/second, and Y points down.
// The body is a driven mass; its four planted paws feed a digitigrade IK rig.
export class Cat {
  constructor({ x = 0, terrain = () => 0 } = {}) {
    this.terrain = terrain;
    this.reset(x, terrain);
  }

  reset(x = 0, terrain = this.terrain) {
    this.terrain = terrain || (() => 0);
    this.x = x;
    this.y = this.terrain(x) - 44;
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
    this._tail = Array.from({ length: 9 }, (_, i) => ({ angle: -2.7 + i * 0.14, velocity: 0 }));
    this.legs = [
      { name: 'posteriore lontana', kind: 'hind', far: true, rootX: -30, offset: 0.25 },
      { name: 'anteriore lontana', kind: 'front', far: true, rootX: 22, offset: 0.5 },
      { name: 'posteriore vicina', kind: 'hind', far: false, rootX: -27, offset: 0.75 },
      { name: 'anteriore vicina', kind: 'front', far: false, rootX: 26, offset: 0 },
    ];
    this._resetFeet();
    this._updatePose();
  }

  _resetFeet() {
    for (const leg of this.legs) {
      const x = this.x + this.facing * (leg.rootX + 3);
      leg.paw = { x, y: this.terrain(x) - 1.5 };
      leg.from = { ...leg.paw };
      leg.to = { ...leg.paw };
      leg.stance = true;
      leg.swingProgress = 0;
      leg.forcedSwing = false;
      leg.settling = null;
      leg.airPaw = null;
    }
  }

  update(dt, input = {}, terrain = this.terrain) {
    // A fixed simulation step is expected; keep integration stable for callers
    // that resume a tab after it has been suspended.
    dt = clamp(dt, 0, 1 / 30);
    if (!dt) return;
    this.terrain = terrain || this.terrain;
    this.time += dt;
    const direction = clamp(input.direction || 0, -1, 1);
    const oldVx = this.vx;
    const previousGrounded = this.grounded;
    const maximumSpeed = input.run ? 310 : 138;

    if (this.grounded) {
      this._coyote = 0.1;
      if (direction) {
        const reversing = direction * this.vx < -5;
        const acceleration = reversing ? 1010 : input.run ? 760 : 590;
        this.vx = approach(this.vx, direction * maximumSpeed, acceleration * dt);
      } else {
        // Contact friction brings the body to rest over a measurable distance.
        this.vx = approach(this.vx, 0, (400 + Math.abs(this.vx) * 0.25) * dt);
      }
    } else {
      this._coyote = Math.max(0, this._coyote - dt);
      if (direction) {
        const target = direction * maximumSpeed;
        // Running momentum survives releasing A during a jump.
        if (Math.sign(this.vx) !== direction || Math.abs(this.vx) < maximumSpeed) {
          this.vx = approach(this.vx, target, 230 * dt);
        }
      }
      this.vx *= Math.exp(-0.08 * dt);
    }
    this._acceleration = (this.vx - oldVx) / dt;
    this._effort = lerp(this._effort, clamp(Math.abs(this._acceleration) / 760 + Math.abs(this.vx) / 620, 0, 1), 1 - Math.exp(-dt * 5));
    this.x += this.vx * dt;

    // The cat turns only once its actual momentum changes direction.
    const newFacing = Math.abs(this.vx) > 16 ? Math.sign(this.vx)
      : Math.abs(this.vx) < 4 && direction ? direction : this.facing;
    if (newFacing !== this.facing) {
      this.facing = newFacing;
      if (this.grounded) {
        this._resetFeet();
      } else {
        // Turning in flight must never reset a foot to the ground below.
        for (const leg of this.legs) {
          leg.paw = { x: this.x + this.facing * (leg.rootX + 3), y: this.y + 30 };
          leg.airPaw = null;
        }
      }
    }

    this._jumpBuffer = input.jumpPressed ? 0.13 : Math.max(0, this._jumpBuffer - dt);
    if (this._jumpBuffer > 0 && (this.grounded || this._coyote > 0)) {
      this.vy = -390;
      this.grounded = false;
      this._coyote = 0;
      this._jumpBuffer = 0;
      this._jumpTime = 0;
      this._jumpCut = false;
      this._squashVelocity = -27;
      this.jumpCount += 1;
    }

    const supportY = this._groundHeight();
    const groundY = supportY - 44;
    if (!this.grounded) {
      this._jumpTime += dt;
      if (!input.jumpHeld && this.vy < -240 && !this._jumpCut) {
        this.vy = -240;
        this._jumpCut = true;
      }
      const holdLift = input.jumpHeld && this.vy < 0 && this._jumpTime < 0.19;
      this.vy += (holdLift ? 790 : 1080) * dt;
      this.y += this.vy * dt;
      if (this.y >= groundY && this.vy >= 0) {
        const impact = this.vy;
        this.y = groundY;
        this.vy = 0;
        this.grounded = true;
        this._landing = clamp(impact / 440, 0, 1);
        this._squashVelocity += Math.min(impact * 0.075, 32);
        // Airborne paws blend to their first contact; no sliding across the map.
        for (const leg of this.legs) {
          const footX = this.x + this.facing * (leg.rootX + 3 + this.vx * 0.016);
          leg.paw = { x: footX, y: this.terrain(footX) - 1.5 };
          leg.stance = true;
        }
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
      : this._speed < 160 ? 'passo' : this._speed < 255 ? 'trotto' : 'galoppo';
    const terrainPitch = this.grounded
      ? clamp((this.terrain(this.x + this.facing * 28) - this.terrain(this.x - this.facing * 28)) / 56, -0.3, 0.3) : 0;
    const pitchTarget = clamp(this._acceleration * this.facing / 22000, -0.045, 0.045)
      + (this.grounded ? 0 : clamp(this.vy / 4200, -0.07, 0.07));
    this._motionPitch = lerp(this._motionPitch, pitchTarget, 1 - Math.exp(-dt * 8));
    this._pitch = terrainPitch + this._motionPitch;
    this._updateFeet(dt, previousGrounded);
    this._updateTail(dt);
    this._updatePose();
  }

  _groundHeight() {
    // Both ends of the spine react to slopes without introducing vertical drift.
    return (this.terrain(this.x - 24) + this.terrain(this.x + 24)) * 0.5;
  }

  _updateFeet(dt) {
    const speed = this._speed;
    const trot = smooth(clamp((speed - 135) / 75, 0, 1));
    const gallop = smooth(clamp((speed - 235) / 55, 0, 1));
    const stride = lerp(lerp(66, 82, trot), 100, gallop);
    const frequency = speed / stride;
    const duty = lerp(lerp(0.68, 0.56, trot), 0.43, gallop);
    this.phase = wrap(this.phase + frequency * dt);

    for (const leg of this.legs) {
      const walkOffset = leg.kind === 'front' ? leg.far ? 0.5 : 0 : leg.far ? 0.25 : 0.75;
      const trotOffset = leg.kind === 'front' ? leg.far ? 0.5 : 0 : leg.far ? 0 : 0.5;
      const gallopOffset = leg.kind === 'front' ? leg.far ? 0.18 : 0.06 : leg.far ? 0.68 : 0.56;
      let targetOffset = lerp(walkOffset, trotOffset, trot);
      let offsetDistance = gallopOffset - targetOffset;
      if (offsetDistance > 0.5) offsetDistance -= 1;
      if (offsetDistance < -0.5) offsetDistance += 1;
      targetOffset = wrap(targetOffset + offsetDistance * gallop);
      let offsetDelta = targetOffset - leg.offset;
      if (offsetDelta > 0.5) offsetDelta -= 1;
      if (offsetDelta < -0.5) offsetDelta += 1;
      leg.offset = wrap(leg.offset + offsetDelta * Math.min(1, dt * 7));

      if (!this.grounded) {
        const rising = clamp(-this.vy / 390, 0, 1);
        const falling = clamp(this.vy / 390, 0, 1);
        const farOffset = leg.far ? 3 : 0;
        const localX = leg.kind === 'front'
          ? 29 + rising * 15 + falling * 8 + farOffset
          : -26 - rising * 10 - falling * 7 - farOffset;
        const localY = 26 - rising * 7 + falling * 12;
        const blend = 1 - Math.exp(-dt * 16);
        if (!leg.airPaw) {
          leg.airPaw = { x: (leg.paw.x - this.x) * this.facing, y: leg.paw.y - this.y };
        }
        // An airborne paw travels with its torso; interpolate only articulation
        // so a fast rising body cannot pull the leg beyond its bone lengths.
        leg.airPaw.x = lerp(leg.airPaw.x, localX, blend);
        leg.airPaw.y = lerp(leg.airPaw.y, localY, blend);
        leg.paw.x = this.x + this.facing * leg.airPaw.x;
        leg.paw.y = this.y + leg.airPaw.y;
        leg.stance = false;
        leg.forcedSwing = false;
        leg.settling = null;
        continue;
      }
      leg.airPaw = null;

      if (speed < 8 || leg.settling) {
        // Preserve each contact at rest. Only recover a paw that is too extended.
        const relativeX = (leg.paw.x - this.x) * this.facing - leg.rootX;
        if (!leg.settling && (Math.abs(relativeX) > 18 || !leg.stance)) {
          const targetX = this.x + this.facing * (leg.rootX + 3);
          leg.settling = { from: { ...leg.paw }, to: { x: targetX, y: this.terrain(targetX) - 1.5 }, progress: 0 };
        }
        if (leg.settling) {
          const step = leg.settling;
          step.progress = Math.min(1, step.progress + dt / 0.17);
          const eased = smooth(step.progress);
          leg.paw.x = lerp(step.from.x, step.to.x, eased);
          leg.paw.y = lerp(step.from.y, step.to.y, eased) - Math.sin(step.progress * Math.PI) * 4;
          leg.stance = false;
          if (step.progress === 1) {
            leg.settling = null;
            leg.stance = true;
            leg.offset = wrap(-this.phase);
          }
        } else {
          leg.paw.y = this.terrain(leg.paw.x) - 1.5;
          leg.stance = true;
        }
        leg.forcedSwing = false;
        continue;
      }

      let cycle = wrap(this.phase + leg.offset);
      const reach = stride * duty * 0.49;
      const relativeX = (leg.paw.x - this.x) * this.facing - leg.rootX;
      // Accelerating or changing gait can shorten a stance. Lift before the
      // planted limb reaches its anatomical limit, rather than sliding the paw.
      if (leg.stance && cycle < duty && relativeX < -reach - 4) {
        leg.forcedSwing = true;
        leg.forcedProgress = 0;
      }
      if (leg.forcedSwing) {
        leg.forcedProgress += frequency * dt / (1 - duty);
        if (leg.forcedProgress >= 1) {
          leg.forcedSwing = false;
          leg.offset = wrap(-this.phase);
          cycle = 0;
        } else {
          cycle = duty + leg.forcedProgress * (1 - duty);
        }
      }
      const inStance = cycle < duty;
      if (!inStance) {
        const p = clamp((cycle - duty) / (1 - duty), 0, 1);
        if (leg.stance) {
          leg.from = { ...leg.paw };
          leg.fromLocal = (leg.paw.x - this.x) * this.facing - leg.rootX;
          leg.swingProgress = p;
          leg.stance = false;
        }
        const normalized = clamp((p - leg.swingProgress) / Math.max(0.08, 1 - leg.swingProgress), 0, 1);
        const travel = stride * (1 - duty) / 3;
        // Endpoint derivatives cancel body velocity at lift-off and touchdown.
        // Working in body space lets the stride adapt immediately to acceleration.
        const relative = cubic(leg.fromLocal, leg.fromLocal - travel,
          reach + travel, reach, normalized);
        leg.paw.x = this.x + this.facing * (leg.rootX + relative);
        leg.paw.y = this.terrain(leg.paw.x) - 1.5
          - Math.sin(normalized * Math.PI) * lerp(10, 22, gallop);
        const landingX = this.x + this.facing * (leg.rootX + reach);
        leg.to = { x: landingX, y: this.terrain(landingX) - 1.5 };
      } else {
        if (!leg.stance) {
          leg.paw = { ...leg.to };
          leg.stance = true;
        }
        leg.paw.y = this.terrain(leg.paw.x) - 1.5;
      }
    }
  }

  _updateTail(dt) {
    const running = clamp(this._speed / 290, 0, 1);
    for (let i = 0; i < this._tail.length; i += 1) {
      const joint = this._tail[i];
      const idleAngle = -2.7 + i * 0.14;
      const runAngle = -3.01 + Math.sin(this.phase * TAU - i * 0.5) * (0.08 + i * 0.016);
      const inertial = clamp(-this._acceleration * this.facing / 15000, -0.08, 0.08) * (i + 1) / 9;
      const target = lerp(idleAngle, runAngle, running)
        + Math.sin(this.time * 1.7 - i * 0.3) * 0.025 + inertial
        + (!this.grounded ? Math.sin(this._jumpTime * 6 - i * 0.35) * 0.075 : 0);
      joint.velocity += ((target - joint.angle) * (95 - i * 4) - joint.velocity * 12) * dt;
      joint.angle += joint.velocity * dt;
    }
  }

  _updatePose() {
    const movement = clamp(this._speed / 150, 0, 1);
    const gallop = clamp((this._speed - 240) / 65, 0, 1);
    const cycle = this.phase * TAU;
    const breathing = Math.sin(this.time * 2.1) * 0.35 * (1 - movement);
    const bob = this.grounded ? Math.cos(cycle * (gallop > 0.5 ? 1 : 2)) * movement * lerp(1, 2.4, gallop) : 0;
    const flex = Math.sin(cycle) * gallop * 2.5;
    const naturalBase = breathing + bob + this._squash;
    let necessaryDrop = 0;
    if (this.grounded) {
      for (const leg of this.legs) {
        if (!leg.stance) continue;
        const front = leg.kind === 'front';
        const rootX = leg.rootX + (front ? -flex * 0.3 : flex * 0.35);
        const rootY = naturalBase + (front ? 2 + this._pitch * 25 : 4 - this._pitch * 28)
          - (leg.far ? 1.5 : 0);
        const ankleX = (leg.paw.x - this.x) * this.facing - (front ? 1 : 7);
        const ankleY = leg.paw.y - this.y - (front ? 5 : 8);
        const combinedReach = front ? 45.3 : 53.3;
        const allowedVertical = Math.sqrt(Math.max(1, combinedReach ** 2 - (ankleX - rootX) ** 2));
        necessaryDrop = Math.max(necessaryDrop, ankleY - rootY - allowedVertical);
      }
    }
    // On a crest, bend the spine down toward a low planted paw before extending
    // any bone. Relax smoothly once all contacts can reach the normal posture.
    this._rigDrop = Math.max(clamp(necessaryDrop, 0, 12), this._rigDrop * 0.94);
    const base = naturalBase + this._rigDrop;
    const hip = point(-28 + flex * 0.35, base + 4 - this._pitch * 28);
    const shoulder = point(25 - flex * 0.3, base + 4 + this._pitch * 25);
    this.pose = {
      base, hip, shoulder, flex,
      neck: point(38 - flex * 0.2, base - 5 + this._pitch * 40),
      head: point(51 - flex * 0.2, base - 11 + this._pitch * 48 + (this.grounded ? -bob * 0.45 : 0)),
      tail: [point(-35 + flex * 0.2, base - 2)],
    };
    for (let i = 0; i < this._tail.length; i += 1) {
      const previous = this.pose.tail[this.pose.tail.length - 1];
      const length = 6.5 - i * 0.13;
      const angle = this._tail[i].angle;
      this.pose.tail.push(point(previous.x + Math.cos(angle) * length, previous.y + Math.sin(angle) * length));
    }
    for (const leg of this.legs) {
      const root = leg.kind === 'front' ? { ...shoulder } : { ...hip };
      root.x += leg.rootX - (leg.kind === 'front' ? 25 : -28);
      root.y -= leg.kind === 'front' ? 2 : 0;
      root.y += leg.far ? -1.5 : 0;
      const paw = point((leg.paw.x - this.x) * this.facing, leg.paw.y - this.y);
      const ankle = leg.kind === 'hind' ? point(paw.x - 7, paw.y - 8)
        : point(paw.x - 1, paw.y - 5);
      const reach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
      const anatomicalReach = leg.kind === 'hind' ? 45.5 : 37.5;
      if (reach > anatomicalReach) {
        // Scapular glide and pelvic excursion accommodate the final few pixels
        // of extension while the toe remains fixed against the ground.
        const glide = Math.min(8, reach - anatomicalReach);
        root.x += (ankle.x - root.x) / reach * glide;
        root.y += (ankle.y - root.y) / reach * glide;
      }
      const remainingReach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
      if (!leg.stance && remainingReach > anatomicalReach) {
        // A swinging paw has no contact constraint. Project the target into the
        // reachable disk instead of stretching a forearm to chase the terrain.
        const ratio = anatomicalReach / remainingReach;
        const constrainedX = root.x + (ankle.x - root.x) * ratio;
        const constrainedY = root.y + (ankle.y - root.y) * ratio;
        paw.x += constrainedX - ankle.x;
        paw.y += constrainedY - ankle.y;
        ankle.x = constrainedX;
        ankle.y = constrainedY;
        leg.paw.x = this.x + this.facing * paw.x;
        leg.paw.y = this.y + paw.y;
      }
      const bend = leg.kind === 'hind' ? -1 : 1;
      const joint = this._ik(root, ankle, leg.kind === 'hind' ? 22 : 18, leg.kind === 'hind' ? 24 : 20, bend);
      leg.pose = { root, joint, ankle, paw };
    }
  }

  _ik(root, foot, upper, lower, bend) {
    const dx = foot.x - root.x;
    const dy = foot.y - root.y;
    const distance = clamp(Math.hypot(dx, dy), 0.01, upper + lower - 0.05);
    const direction = Math.atan2(dy, dx);
    const angle = Math.acos(clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1));
    return point(root.x + Math.cos(direction + angle * bend) * upper,
      root.y + Math.sin(direction + angle * bend) * upper);
  }

  draw(ctx, { skeleton = false } = {}) {
    const altitude = Math.max(0, this._groundHeight() - 44 - this.y);
    ctx.save();
    ctx.fillStyle = `rgba(24, 31, 34, ${0.13 * Math.max(0.2, 1 - altitude / 120)})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.terrain(this.x) + 1, 46 - Math.min(12, altitude * 0.12), 3.2, 0, 0, TAU);
    ctx.fill();
    ctx.translate(this.x, this.y);
    ctx.scale(this.facing, 1);
    this._drawTail(ctx);
    for (const leg of this.legs.filter(leg => leg.far)) this._drawLeg(ctx, leg, '#283032');
    this._drawBody(ctx);
    for (const leg of this.legs.filter(leg => !leg.far)) this._drawLeg(ctx, leg, '#101719');
    this._drawHead(ctx);
    if (skeleton) this._drawSkeleton(ctx);
    ctx.restore();
  }

  _drawTail(ctx) {
    const nodes = this.pose.tail;
    const left = [];
    const right = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const previous = nodes[Math.max(0, i - 1)];
      const next = nodes[Math.min(nodes.length - 1, i + 1)];
      const angle = Math.atan2(next.y - previous.y, next.x - previous.x) + Math.PI / 2;
      const radius = lerp(4.2, 0.85, i / (nodes.length - 1));
      left.push(point(nodes[i].x + Math.cos(angle) * radius, nodes[i].y + Math.sin(angle) * radius));
      right.push(point(nodes[i].x - Math.cos(angle) * radius, nodes[i].y - Math.sin(angle) * radius));
    }
    ctx.fillStyle = '#101719';
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    this._smoothPath(ctx, left.slice(1));
    this._smoothPath(ctx, right.reverse());
    ctx.closePath();
    ctx.fill();
  }

  _smoothPath(ctx, points) {
    for (let i = 0; i < points.length - 1; i += 1) {
      const next = points[i + 1];
      ctx.quadraticCurveTo(points[i].x, points[i].y, (points[i].x + next.x) / 2, (points[i].y + next.y) / 2);
    }
    if (points.length) ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  }

  _drawBody(ctx) {
    const { hip, shoulder, base, flex } = this.pose;
    ctx.fillStyle = '#101719';
    ctx.beginPath();
    ctx.moveTo(hip.x - 10, hip.y - 3);
    ctx.bezierCurveTo(hip.x - 14, hip.y - 18, -15, base - 15 + flex, 4, base - 12 - flex * 0.4);
    ctx.bezierCurveTo(18, base - 14, shoulder.x + 9, shoulder.y - 15, shoulder.x + 14, shoulder.y - 4);
    ctx.bezierCurveTo(shoulder.x + 18, shoulder.y + 2, shoulder.x + 10, shoulder.y + 13, shoulder.x + 2, shoulder.y + 13);
    ctx.bezierCurveTo(10, base + 15, -4, base + 7, -17, base + 10);
    ctx.bezierCurveTo(hip.x - 2, hip.y + 13, hip.x - 13, hip.y + 11, hip.x - 10, hip.y - 3);
    ctx.closePath();
    ctx.fill();
    // Small shoulder and haunch masses join the articulated limbs to the torso.
    ctx.beginPath();
    ctx.ellipse(hip.x, hip.y + 1, 11.5, 11, -0.25, 0, TAU);
    ctx.ellipse(shoulder.x, shoulder.y + 1, 8.5, 12, 0.15, 0, TAU);
    ctx.fill();
  }

  _drawLeg(ctx, leg, color) {
    const { root, joint, ankle, paw } = leg.pose;
    ctx.fillStyle = color;
    const radii = leg.kind === 'hind' ? [7.8, 4.7, 2.8, 2.4] : [5.8, 3.9, 2.5, 2.5];
    const nodes = [root, joint, ankle, paw];
    // The tapered envelope follows bone segments rather than scaling a sprite.
    const left = [];
    const right = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const previous = nodes[Math.max(0, i - 1)];
      const next = nodes[Math.min(nodes.length - 1, i + 1)];
      const angle = Math.atan2(next.y - previous.y, next.x - previous.x) + Math.PI / 2;
      left.push(point(nodes[i].x + Math.cos(angle) * radii[i], nodes[i].y + Math.sin(angle) * radii[i]));
      right.push(point(nodes[i].x - Math.cos(angle) * radii[i], nodes[i].y - Math.sin(angle) * radii[i]));
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    this._smoothPath(ctx, left.slice(1));
    this._smoothPath(ctx, right.reverse());
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(paw.x + 2.2, paw.y - 0.5, 5.1, 2.6, -0.04, 0, TAU);
    ctx.fill();
  }

  _drawHead(ctx) {
    const { head, neck, shoulder } = this.pose;
    ctx.fillStyle = '#101719';
    ctx.beginPath();
    ctx.moveTo(shoulder.x - 2, shoulder.y - 11);
    ctx.bezierCurveTo(neck.x - 3, neck.y - 11, head.x - 7, head.y - 8, head.x + 2, head.y - 8);
    ctx.lineTo(head.x + 10, head.y - 10);
    ctx.bezierCurveTo(head.x + 15, head.y - 6, head.x + 12, head.y - 1, head.x + 17, head.y + 1);
    ctx.quadraticCurveTo(head.x + 20, head.y + 2, head.x + 17, head.y + 5);
    ctx.lineTo(head.x + 12, head.y + 6);
    ctx.quadraticCurveTo(head.x + 6, head.y + 13, head.x - 2, head.y + 9);
    ctx.bezierCurveTo(neck.x + 1, neck.y + 12, shoulder.x + 8, shoulder.y + 11, shoulder.x + 2, shoulder.y + 10);
    ctx.closePath();
    ctx.fill();
    // Two triangular ears with curved outer edges and an angular feline muzzle.
    ctx.beginPath();
    ctx.moveTo(head.x - 8, head.y - 6);
    ctx.quadraticCurveTo(head.x - 10, head.y - 12, head.x - 8, head.y - 21);
    ctx.quadraticCurveTo(head.x - 2, head.y - 17, head.x + 1, head.y - 9);
    ctx.moveTo(head.x + 1, head.y - 7);
    ctx.quadraticCurveTo(head.x + 4, head.y - 16, head.x + 9, head.y - 20);
    ctx.quadraticCurveTo(head.x + 12, head.y - 13, head.x + 10, head.y - 7);
    ctx.fill();
    // The restrained eye remains readable in the pale landscape.
    ctx.fillStyle = '#e0e6d8';
    ctx.beginPath();
    ctx.ellipse(head.x + 9, head.y - 1.1, 1.55, 0.92, -0.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#101719';
    ctx.fillRect(head.x + 9.1, head.y - 2.1, 0.55, 1.8);
    ctx.strokeStyle = 'rgba(28, 36, 38, 0.6)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(head.x + 14, head.y + 5);
    ctx.quadraticCurveTo(head.x + 21, head.y + 3, head.x + 24, head.y + 4);
    ctx.moveTo(head.x + 13, head.y + 6);
    ctx.quadraticCurveTo(head.x + 20, head.y + 6, head.x + 24, head.y + 8);
    ctx.stroke();
  }

  _drawSkeleton(ctx) {
    const { hip, shoulder, neck, head, base, tail } = this.pose;
    ctx.save();
    ctx.strokeStyle = '#e6ca91';
    ctx.fillStyle = '#e6ca91';
    ctx.lineWidth = 1.05;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(230, 202, 145, 0.25)';
    ctx.shadowBlur = 3;
    for (const leg of this.legs) {
      ctx.globalAlpha = leg.far ? 0.36 : 0.9;
      const { root, joint, ankle, paw } = leg.pose;
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.lineTo(joint.x, joint.y);
      ctx.lineTo(ankle.x, ankle.y);
      ctx.lineTo(paw.x + 3, paw.y);
      ctx.stroke();
      for (const jointPoint of [root, joint, ankle]) this._joint(ctx, jointPoint, 1.7);
    }
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(hip.x - 4, hip.y - 5);
    ctx.bezierCurveTo(-14, base - 7 + this.pose.flex, 10, base - 5, shoulder.x, shoulder.y - 7);
    ctx.quadraticCurveTo(neck.x, neck.y - 5, head.x - 1, head.y);
    ctx.stroke();
    // Visible vertebrae and rib arcs make the axial skeleton inspectable.
    for (let i = 0; i < 10; i += 1) {
      const t = i / 9;
      const x = lerp(hip.x - 1, shoulder.x - 2, t);
      const y = base - 5 + Math.sin(t * Math.PI) * this.pose.flex * 0.4;
      this._joint(ctx, point(x, y), 1.1);
    }
    ctx.globalAlpha = 0.65;
    for (let i = 0; i < 6; i += 1) {
      const x = 3 + i * 3.4;
      ctx.beginPath();
      ctx.moveTo(x, base - 5);
      ctx.bezierCurveTo(x + 5, base - 2, x + 6, base + 9, x + 2, base + 10);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(hip.x, hip.y - 0.5, 6, 4.5, -0.25, 0, TAU);
    ctx.moveTo(shoulder.x - 8, shoulder.y - 10);
    ctx.lineTo(shoulder.x + 3, shoulder.y - 7);
    ctx.lineTo(shoulder.x, shoulder.y + 2);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(head.x + 2, head.y + 1, 9, 7, -0.1, 0, TAU);
    ctx.moveTo(head.x + 9, head.y + 3);
    ctx.lineTo(head.x + 15, head.y + 4);
    ctx.lineTo(head.x + 9, head.y + 7);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(tail[0].x, tail[0].y);
    this._smoothPath(ctx, tail.slice(1));
    ctx.stroke();
    for (let i = 1; i < tail.length; i += 1) this._joint(ctx, tail[i], 0.85);
    ctx.restore();
  }

  _joint(ctx, location, radius) {
    ctx.beginPath();
    ctx.arc(location.x, location.y, radius, 0, TAU);
    ctx.fill();
  }

  getTelemetry() {
    return { speed: this._speed, grounded: this.grounded, gait: this.gait, effort: this._effort };
  }
}

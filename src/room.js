const TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export const ROOM_BOUNDS = Object.freeze({ min: -580, max: 580, ceiling: -390 });
export const ROOM_PLATFORMS = Object.freeze([
  Object.freeze({ id: 'sofa', x1: 180, x2: 400, y: -48, solid: true }),
  Object.freeze({ id: 'ottoman', x1: -250, x2: -140, y: -28, solid: true }),
  Object.freeze({ id: 'cabinet', x1: -485, x2: -385, y: -68, solid: true }),
]);
export const roomTerrain = Object.assign(() => 0, { bounds: ROOM_BOUNDS, platforms: ROOM_PLATFORMS });

const TARGETS = [
  { x: 105, y: -2 }, { x: -325, y: -2 }, { x: 260, y: -50 },
  { x: -195, y: -30 }, { x: 350, y: -50 }, { x: -430, y: -70 },
  { x: 475, y: -2 }, { x: -65, y: -2 },
];

export class Laser {
  constructor() { this.reset(); }

  reset() {
    this.x = this.targetX = TARGETS[0].x;
    this.y = this.targetY = TARGETS[0].y;
    this.score = 0; this.age = 0; this.time = 0; this.flash = 0;
    this.index = 0; this.cooldown = 0; this.jumpCooldown = 0;
    this.trail = []; this.catchX = this.x; this.catchY = this.y;
  }

  place(x, y) {
    x = clamp(x, ROOM_BOUNDS.min + 55, ROOM_BOUNDS.max - 55);
    const covering = ROOM_PLATFORMS.filter(p => x >= p.x1 && x <= p.x2);
    const choices = covering.length ? covering.map(p => ({ x, y: p.y - 2 })) : [{ x, y: -2 }];
    choices.sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y));
    this.targetX = choices[0].x; this.targetY = choices[0].y;
    this.x = this.targetX; this.y = this.targetY;
    this.age = 0; this.cooldown = .4; this.trail.length = 0;
  }

  next() {
    this.index = (this.index + 1) % TARGETS.length;
    const point = TARGETS[this.index];
    this.targetX = point.x; this.targetY = point.y;
    this.x = point.x; this.y = point.y;
    this.age = 0; this.cooldown = .7; this.trail.length = 0;
  }

  update(dt, cat) {
    this.time += dt; this.age += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.x = this.targetX + Math.sin(this.time * 1.4) * 3;
    this.y = this.targetY;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 16) this.trail.shift();
    const touches = cat.legs.some(leg => Math.hypot(leg.paw.x - this.x, leg.paw.y - this.y) < 14);
    const head = { x: cat.x + cat.facing * cat.pose.head.x * cat.size, y: cat.y + cat.pose.head.y * cat.size };
    if (!this.cooldown && (touches || Math.hypot(head.x - this.x, head.y - this.y) < 15)) {
      this.score += 1;
      this.catchX = this.x; this.catchY = this.y; this.flash = .9;
      this.next();
    }
  }

  inputFor(cat) {
    const difference = this.x - cat.x;
    const direction = Math.abs(difference) < 9 ? 0 : Math.sign(difference);
    let obstacle = null;
    for (const p of ROOM_PLATFORMS) {
      const edge = direction > 0 ? p.x1 : p.x2;
      const distance = (edge - cat.x) * direction;
      if (direction && distance > 0 && distance < 67 && p.y < (cat.supportY ?? 0) - 5) {
        if (!obstacle || distance < obstacle.distance) obstacle = { platform: p, distance };
      }
    }
    const higherTarget = this.y < (cat.supportY ?? 0) - 14;
    const shouldJump = cat.grounded && !this.jumpCooldown &&
      ((obstacle && obstacle.distance < 52) || (higherTarget && Math.abs(difference) < 100));
    if (shouldJump) this.jumpCooldown = .95;
    return {
      direction,
      run: Math.abs(difference) > 210 && !obstacle,
      jumpPressed: !!shouldJump,
      jumpHeld: shouldJump || (!cat.grounded && cat.vy < 0),
    };
  }
}

function rounded(ctx, x, y, w, h, radius, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function glow(ctx, x, y, rx, ry, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
}

export class Room {
  constructor() {
    this.contacts = new Map(); this.particles = []; this.wasGrounded = true;
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.laser = new Laser();
  }

  reset() { this.contacts.clear(); this.particles.length = 0; this.wasGrounded = true; this.laser.reset(); }

  floor(h, w) { return h * (w < 760 ? .68 : .745); }

  screenToWorld(x, y, w, h, cameraX, scale) {
    return { x: (x - w / 2) / scale + cameraX, y: (y - this.floor(h, w)) / scale };
  }

  update(dt, cat) {
    this.laser.update(dt, cat);
    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 22 * dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const leg of cat.legs) {
      const contact = cat.grounded && leg.stance;
      if (contact && this.contacts.get(leg.name) === false && Math.abs(cat.vx) > 210 && !this.reducedMotion) {
        this.particles.push({ x: leg.paw.x, y: leg.paw.y, vx: -cat.vx * .03, vy: -8, life: .4 });
      }
      this.contacts.set(leg.name, contact);
    }
    this.wasGrounded = cat.grounded;
  }

  draw(ctx, w, h, cameraX, scale, time, cat, skeleton) {
    const paper = ctx.createLinearGradient(0, 0, 0, h);
    paper.addColorStop(0, '#f7f6f1'); paper.addColorStop(1, '#eeeee7');
    ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2 - cameraX * scale, this.floor(h, w)); ctx.scale(scale, scale);
    this.drawArchitecture(ctx);
    this.drawWindow(ctx);
    this.drawDecor(ctx);
    this.drawFurniture(ctx);
    this.drawFloor(ctx);

    const altitude = Math.max(0, (cat.supportY ?? 0) - cat.y - cat.supportHeight);
    ctx.save(); ctx.translate(cat.x, cat.supportY ?? 0); ctx.scale(1, .13);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 37);
    shadow.addColorStop(0, `rgba(34,34,30,${.16 / (1 + altitude * .03)})`); shadow.addColorStop(1, 'rgba(34,34,30,0)');
    ctx.fillStyle = shadow; ctx.beginPath(); ctx.ellipse(0, 0, 37, 37, 0, 0, TAU); ctx.fill(); ctx.restore();
    cat.draw(ctx, { skeleton });
    for (const p of this.particles) {
      ctx.fillStyle = `rgba(125,122,112,${Math.max(0, p.life * .28)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, TAU); ctx.fill();
    }
    this.drawLaser(ctx, time);
    glow(ctx, -240, -10, 290, 45, 'rgba(255,255,250,.09)');
    ctx.restore();
  }

  drawArchitecture(ctx) {
    const { min, max, ceiling } = ROOM_BOUNDS;
    const wall = ctx.createLinearGradient(min, ceiling, max, 0);
    wall.addColorStop(0, '#eeede5'); wall.addColorStop(.5, '#f5f3ec'); wall.addColorStop(1, '#e6e5de');
    ctx.fillStyle = wall; ctx.fillRect(min, ceiling, max - min, -ceiling);
    ctx.strokeStyle = '#dadad0'; ctx.lineWidth = 1;
    ctx.strokeRect(min, ceiling, max - min, -ceiling);
    ctx.fillStyle = '#e1e1d8'; ctx.fillRect(min, ceiling, max - min, 9);
    ctx.fillStyle = '#faf9f4'; ctx.fillRect(min + 7, ceiling + 9, max - min - 14, 6);
    ctx.fillStyle = '#dfdfd6'; ctx.fillRect(min, ceiling, 10, -ceiling); ctx.fillRect(max - 10, ceiling, 10, -ceiling);
    ctx.fillStyle = '#f9f8f1'; ctx.fillRect(min + 10, -13, max - min - 20, 12);
    ctx.strokeStyle = '#d3d4c9'; ctx.beginPath(); ctx.moveTo(min + 10, -13); ctx.lineTo(max - 10, -13); ctx.stroke();
    // Quiet wall mouldings and a closed panelled door establish the room limits.
    for (const x of [-350, -70, 420]) {
      ctx.strokeStyle = 'rgba(163,168,150,.15)'; ctx.strokeRect(x, -106, 152, 74);
      ctx.strokeStyle = 'rgba(255,255,250,.8)'; ctx.strokeRect(x + 2, -104, 148, 70);
    }
    rounded(ctx, -552, -281, 84, 281, 2, '#e1e2d8', '#c6cabd');
    rounded(ctx, -545, -273, 70, 266, 2, '#eeeee5', '#d4d7ca');
    for (const y of [-250, -138]) rounded(ctx, -537, y, 54, 91, 1, null, '#d7dacd');
    ctx.fillStyle = '#929780'; ctx.beginPath(); ctx.arc(-486, -130, 2.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#929780'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-486, -130); ctx.lineTo(-496, -130); ctx.stroke();
    // A modest ceiling pendant, drawn behind the scene.
    ctx.strokeStyle = '#b7b9aa'; ctx.lineWidth = .9; ctx.beginPath(); ctx.moveTo(8, ceiling + 14); ctx.lineTo(8, -326); ctx.stroke();
    rounded(ctx, -15, -329, 46, 8, 4, '#dddccf');
    ctx.fillStyle = '#e5e3d7'; ctx.beginPath(); ctx.moveTo(-15, -321); ctx.quadraticCurveTo(-26, -301, -33, -294); ctx.lineTo(49, -294); ctx.quadraticCurveTo(39, -303, 31, -321); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#cecebf'; ctx.lineWidth = .8; ctx.beginPath(); ctx.ellipse(8, -294, 41, 4, 0, 0, TAU); ctx.stroke();
  }

  drawWindow(ctx) {
    glow(ctx, -240, -210, 300, 245, 'rgba(255,255,249,.70)');
    rounded(ctx, -346, -318, 166, 172, 2, '#c8cec5');
    rounded(ctx, -342, -314, 158, 164, 1, '#e9eeeb');
    for (const x of [-337, -260]) for (const y of [-309, -230]) {
      const g = ctx.createLinearGradient(x, y, x + 72, y + 73);
      g.addColorStop(0, '#dce5e1'); g.addColorStop(1, '#f4f7f2');
      ctx.fillStyle = g; ctx.fillRect(x, y, 72, 73);
    }
    ctx.strokeStyle = 'rgba(170,185,171,.24)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-330, -185); ctx.lineTo(-312, -276); ctx.moveTo(-319, -233); ctx.lineTo(-292, -249); ctx.moveTo(-317, -245); ctx.lineTo(-334, -264); ctx.stroke();
    ctx.fillStyle = '#f9faf4'; ctx.fillRect(-265, -309, 5, 154); ctx.fillRect(-337, -235, 148, 5);
    rounded(ctx, -352, -147, 178, 7, 1, '#f9f9f1', '#d3d7c9');
    ctx.fillStyle = '#e2e4da';
    ctx.beginPath(); ctx.moveTo(-358, -328); ctx.lineTo(-330, -328); ctx.bezierCurveTo(-346, -268, -328, -196, -340, -133); ctx.lineTo(-371, -133); ctx.bezierCurveTo(-354, -204, -371, -271, -358, -328); ctx.fill();
    ctx.strokeStyle = 'rgba(151,161,142,.13)'; ctx.lineWidth = .8;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-358 + i * 6, -326); ctx.bezierCurveTo(-365 + i * 7, -245, -352 + i * 7, -180, -363 + i * 6, -135); ctx.stroke(); }
    ctx.fillStyle = 'rgba(246,249,240,.31)'; ctx.beginPath(); ctx.moveTo(-336, -145); ctx.lineTo(-188, -145); ctx.lineTo(28, -1); ctx.lineTo(-292, -1); ctx.closePath(); ctx.fill();
  }

  drawDecor(ctx) {
    rounded(ctx, 58, -292, 93, 115, 1, '#d3d2c5');
    rounded(ctx, 62, -288, 85, 107, 1, '#f8f6ed');
    rounded(ctx, 68, -282, 73, 94, 1, '#e6e8dc');
    ctx.fillStyle = '#d2d7c7'; ctx.beginPath(); ctx.arc(112, -256, 18, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b5beaa'; ctx.beginPath(); ctx.moveTo(68, -219); ctx.quadraticCurveTo(101, -260, 141, -216); ctx.lineTo(141, -188); ctx.lineTo(68, -188); ctx.fill();
    ctx.fillStyle = '#899b82'; ctx.beginPath(); ctx.moveTo(68, -201); ctx.quadraticCurveTo(98, -229, 141, -202); ctx.lineTo(141, -188); ctx.lineTo(68, -188); ctx.fill();
    ctx.strokeStyle = '#b2b7a7'; ctx.lineWidth = .9;
    ctx.beginPath(); ctx.arc(348, -286, 24, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#f7f7ed'; ctx.beginPath(); ctx.arc(348, -286, 22, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8e9681'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(348, -299); ctx.lineTo(348, -286); ctx.lineTo(357, -281); ctx.stroke();
    // Lamp with a soft pool of light and a weighted base.
    glow(ctx, 452, -173, 155, 178, 'rgba(255,253,237,.43)');
    ctx.strokeStyle = '#92998a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(454, -4); ctx.lineTo(454, -190); ctx.stroke();
    ctx.fillStyle = '#e5e4d6'; ctx.beginPath(); ctx.moveTo(434, -211); ctx.lineTo(474, -211); ctx.lineTo(489, -176); ctx.lineTo(419, -176); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c7cbbc'; ctx.lineWidth = .8; ctx.stroke();
    ctx.fillStyle = '#a0a696'; ctx.beginPath(); ctx.ellipse(454, -3, 20, 3, 0, 0, TAU); ctx.fill();
    this.plant(ctx, 111, -5, 66, '#a7b59d');
  }

  plant(ctx, x, y, height, color) {
    const stems = [[-.4, -.7], [.2, -.9], [.48, -.58], [-.65, -.5], [.05, -1]];
    ctx.strokeStyle = '#929e84'; ctx.lineWidth = .8;
    for (const [dx, dy] of stems) {
      const tipX = x + dx * height * .55, tipY = y + dy * height;
      ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.quadraticCurveTo(x + dx * height * .2, tipY + 15, tipX, tipY); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(tipX - dx * 4, tipY + 5, 5, 12, -dx * .8, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#c7cabc'; ctx.beginPath(); ctx.moveTo(x - 12, y - 20); ctx.lineTo(x + 12, y - 20); ctx.lineTo(x + 9, y); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#b7bdaa'; ctx.lineWidth = .7; ctx.stroke();
  }

  drawFurniture(ctx) {
    // Top faces coincide with the collision surfaces, including sofa cushions.
    const sofa = ctx.createLinearGradient(0, -111, 0, 0);
    sofa.addColorStop(0, '#a9afa0'); sofa.addColorStop(.5, '#b4b9aa'); sofa.addColorStop(1, '#8b9480');
    rounded(ctx, 180, -113, 220, 91, 13, sofa);
    rounded(ctx, 196, -105, 89, 53, 10, '#b8bdaf', 'rgba(100,115,91,.18)');
    rounded(ctx, 289, -105, 95, 53, 10, '#b6bdad', 'rgba(100,115,91,.18)');
    rounded(ctx, 180, -48, 220, 35, 8, '#929d85');
    rounded(ctx, 185, -48, 106, 13, 4, '#bec5b3', 'rgba(91,109,80,.12)');
    rounded(ctx, 293, -48, 103, 13, 4, '#bbc3b0', 'rgba(91,109,80,.12)');
    rounded(ctx, 178, -73, 18, 54, 7, '#a5af96');
    rounded(ctx, 384, -73, 18, 54, 7, '#a5af96');
    ctx.fillStyle = '#737c65'; ctx.fillRect(197, -15, 5, 15); ctx.fillRect(378, -15, 5, 15);
    ctx.save(); ctx.translate(232, -78); ctx.rotate(-.12); rounded(ctx, -19, -17, 38, 34, 5, '#d3d5c5', 'rgba(118,128,106,.14)'); ctx.restore();
    ctx.save(); ctx.translate(348, -76); ctx.rotate(.13); rounded(ctx, -17, -19, 34, 38, 5, '#9daa8e', 'rgba(92,111,80,.12)'); ctx.restore();

    rounded(ctx, -250, -28, 110, 25, 8, '#b3b8a8');
    rounded(ctx, -250, -28, 110, 8, 5, '#c4c9b9');
    ctx.strokeStyle = '#a3ad94'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(-243, -18); ctx.lineTo(-147, -18); ctx.stroke();
    ctx.fillStyle = '#909b7d'; ctx.fillRect(-238, -4, 5, 4); ctx.fillRect(-157, -4, 5, 4);

    rounded(ctx, -485, -68, 100, 61, 2, '#c6c7b8', '#b4b7a5');
    rounded(ctx, -488, -71, 106, 3, 1, '#d2d2c3');
    ctx.strokeStyle = '#acb4a0'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(-480, -46); ctx.lineTo(-390, -46); ctx.moveTo(-480, -25); ctx.lineTo(-390, -25); ctx.stroke();
    for (const y of [-56, -36, -16]) rounded(ctx, -441, y, 12, 2, 1, '#939e87');
    ctx.fillStyle = '#a4ab96'; ctx.fillRect(-480, -8, 4, 8); ctx.fillRect(-394, -8, 4, 8);
    this.plant(ctx, -453, -71, 47, '#9da991');
    rounded(ctx, -422, -83, 25, 4, 1, '#aaa998'); rounded(ctx, -424, -79, 28, 4, 1, '#d6d1c1');
  }

  drawFloor(ctx) {
    const floor = ctx.createLinearGradient(0, 0, 0, 120);
    floor.addColorStop(0, '#c8c5b8'); floor.addColorStop(.14, '#d6d3c6'); floor.addColorStop(.65, '#e7e6dc'); floor.addColorStop(1, '#eeeee7');
    ctx.fillStyle = floor; ctx.fillRect(ROOM_BOUNDS.min, 0, ROOM_BOUNDS.max - ROOM_BOUNDS.min, 140);
    ctx.strokeStyle = 'rgba(132,130,114,.18)'; ctx.lineWidth = .65;
    ctx.beginPath(); ctx.moveTo(ROOM_BOUNDS.min, 0); ctx.lineTo(ROOM_BOUNDS.max, 0); ctx.stroke();
    for (const y of [18, 43, 75]) {
      ctx.strokeStyle = `rgba(151,148,129,${.13 - y * .0011})`;
      ctx.beginPath(); ctx.moveTo(ROOM_BOUNDS.min, y); ctx.lineTo(ROOM_BOUNDS.max, y); ctx.stroke();
    }
    for (let x = ROOM_BOUNDS.min; x < ROOM_BOUNDS.max; x += 96) {
      ctx.strokeStyle = 'rgba(137,135,117,.09)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 28, 42); ctx.stroke();
    }
    ctx.save(); ctx.translate(18, 20); ctx.scale(1, .18);
    ctx.fillStyle = 'rgba(117,130,104,.07)'; ctx.beginPath(); ctx.ellipse(0, 0, 150, 80, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(117,130,104,.12)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 143, 72, 0, 0, TAU); ctx.stroke(); ctx.restore();
    // A water bowl at the right wall, outside the jumping route.
    ctx.fillStyle = '#adb5a0'; ctx.beginPath(); ctx.ellipse(523, 4, 16, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#dbe3d5'; ctx.beginPath(); ctx.ellipse(523, 2, 13, 2, 0, 0, TAU); ctx.fill();
  }

  drawLaser(ctx) {
    const laser = this.laser;
    const bloom = ctx.createRadialGradient(laser.x, laser.y, 0, laser.x, laser.y, 21);
    bloom.addColorStop(0, 'rgba(224,61,53,.25)'); bloom.addColorStop(.35, 'rgba(226,65,59,.12)'); bloom.addColorStop(1, 'rgba(226,65,59,0)');
    ctx.fillStyle = bloom; ctx.fillRect(laser.x - 22, laser.y - 22, 44, 44);
    ctx.strokeStyle = 'rgba(215,54,50,.19)'; ctx.lineWidth = 1; ctx.beginPath();
    laser.trail.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    ctx.fillStyle = '#e7433d'; ctx.beginPath(); ctx.arc(laser.x, laser.y, 2.25, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff0e8'; ctx.beginPath(); ctx.arc(laser.x - .25, laser.y - .35, .65, 0, TAU); ctx.fill();
    if (laser.flash > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, laser.flash * 2);
      ctx.strokeStyle = '#c86154'; ctx.lineWidth = .7; ctx.beginPath(); ctx.arc(laser.catchX, laser.catchY, 8 + (1 - laser.flash) * 20, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ad685b'; ctx.font = '8px "DM Sans", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PRESO.', laser.catchX, laser.catchY - 19 - (1 - laser.flash) * 9);
      ctx.restore();
    }
  }
}

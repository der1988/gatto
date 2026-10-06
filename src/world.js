const TAU = Math.PI * 2;

function random(seed) {
  let n = seed | 0;
  return () => {
    n += 0x6d2b79f5;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function terrain(x) {
  const undulation = -9 * Math.sin(x / 310) - 5 * Math.sin(x / 107);
  const local = ((x + 800) % 1600 + 1600) % 1600 - 800;
  const ridge = Math.abs(local - 580) < 112 ? -28 * (1 + Math.cos((local - 580) / 112 * Math.PI)) / 2 : 0;
  return undulation + ridge;
}

export class World {
  constructor() {
    this.trees = new Map();
    this.particles = [];
    this.lastSpeed = 0;
    this.stepDistance = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  tree(seed) {
    if (this.trees.has(seed)) return this.trees.get(seed);
    const rng = random(seed);
    const branches = [];
    const h = 210 + rng() * 130;
    const branch = (x, y, length, angle, width, depth) => {
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      const bendX = x + Math.cos(angle + .13) * length * .55;
      const bendY = y + Math.sin(angle + .13) * length * .55;
      branches.push({ x, y, endX, endY, bendX, bendY, width });
      if (depth <= 0) return;
      branch(endX, endY, length * (.56 + rng() * .13), angle - .12 + rng() * .25, width * .6, depth - 1);
      if (depth > 1 || rng() > .2) {
        const t = .57 + rng() * .23;
        branch(x + (endX - x) * t, y + (endY - y) * t, length * (.38 + rng() * .23), angle + (rng() > .5 ? 1 : -1) * (.35 + rng() * .55), width * .43, depth - 1);
      }
    };
    branch(0, 0, h * .52, -Math.PI / 2 + (rng() - .5) * .13, 8 + rng() * 6, 5);
    const result = { branches, h };
    this.trees.set(seed, result);
    if (this.trees.size > 140) this.trees.delete(this.trees.keys().next().value);
    return result;
  }

  drawTree(ctx, tree, x, y, size, opacity) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    ctx.strokeStyle = `rgba(91,100,82,${opacity})`;
    ctx.lineCap = 'round';
    for (const b of tree.branches) {
      ctx.lineWidth = b.width;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.quadraticCurveTo(b.bendX, b.bendY, b.endX, b.endY);
      ctx.stroke();
    }
    ctx.restore();
  }

  mist(ctx, x, y, rx, ry, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const fog = ctx.createRadialGradient(0, 0, .05, 0, 0, 1);
    fog.addColorStop(0, `rgba(250,250,247,${alpha})`);
    fog.addColorStop(.45, `rgba(250,250,247,${alpha * .72})`);
    fog.addColorStop(1, 'rgba(250,250,247,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  update(dt, cat) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 2);
      p.vy += 35 * dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    const speed = Math.abs(cat.vx);
    if (cat.grounded && speed > 100) {
      this.stepDistance += speed * dt;
      if (this.stepDistance > 35) {
        this.stepDistance = 0;
        this.dust(cat.x - cat.facing * 30, terrain(cat.x), 2, -cat.vx * .12);
      }
    }
    if (cat.grounded && !this.wasGrounded) this.dust(cat.x, terrain(cat.x), 10, 0);
    this.wasGrounded = cat.grounded;
  }

  dust(x, y, count, drift) {
    if (this.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      this.particles.push({ x: x + (Math.random() - .5) * 28, y: y - 2, vx: drift + (Math.random() - .5) * 36, vy: -15 - Math.random() * 28, life: .4 + Math.random() * .5, radius: .7 + Math.random() * 1.3 });
    }
  }

  draw(ctx, w, h, cameraX, scale, time, cat, skeleton) {
    const floor = h * (w < 760 ? .635 : .69);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#f7f7f4');
    bg.addColorStop(.5, '#f0f1ed');
    bg.addColorStop(1, '#f5f5f0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const sun = ctx.createRadialGradient(w * .70, h * .28, 10, w * .70, h * .28, w * .36);
    sun.addColorStop(0, 'rgba(255,255,253,.85)');
    sun.addColorStop(1, 'rgba(255,255,253,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    // Distant banks move more slowly than the cat, giving the mist depth.
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      const offset = cameraX * scale * (.045 + layer * .045);
      for (let x = -10; x <= w + 12; x += 12) {
        const y = floor - (45 + layer * 7) * scale + Math.sin((x + offset) / (280 - layer * 35)) * (13 + layer * 5) * scale + Math.cos((x + offset) / 160) * 7;
        if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(w + 12, floor + 40); ctx.lineTo(-10, floor + 40); ctx.closePath();
      ctx.fillStyle = ['rgba(168,177,154,.045)', 'rgba(145,156,132,.04)', 'rgba(123,138,109,.035)'][layer];
      ctx.fill();
    }

    for (let layer = 0; layer < 3; layer++) {
      const parallax = [.09, .17, .28][layer];
      const spacing = [175, 240, 380][layer] * scale;
      const offset = cameraX * scale * parallax;
      const start = Math.floor((offset - w / 2) / spacing) - 1;
      const end = Math.ceil((offset + w / 2) / spacing) + 1;
      for (let i = start; i <= end; i++) {
        const rng = random(i * 907 + layer * 8347 + 618);
        const x = w / 2 + i * spacing - offset + (rng() - .5) * spacing * .7;
        const y = floor - (28 + layer * 6 + rng() * 13) * scale;
        const size = (.42 + layer * .21 + rng() * .18) * scale;
        // Leave the opening around the cat airy and legible.
        const opening = Math.abs(x - w * .46) < w * .2 ? .38 : 1;
        this.drawTree(ctx, this.tree(i * 139 + layer * 857 + 3387), x, y, size, [.036, .047, .065][layer] * opening);
      }
    }
    const drift = this.reducedMotion ? 0 : Math.sin(time * .035) * 70;
    this.mist(ctx, w * .28 + drift, floor - 90 * scale, w * .55, 80 * scale, .66);
    this.mist(ctx, w * .76 - drift, floor - 47 * scale, w * .44, 49 * scale, .78);

    ctx.save();
    ctx.translate(w / 2 - cameraX * scale, floor);
    ctx.scale(scale, scale);
    const left = cameraX - w / (2 * scale);
    const right = cameraX + w / (2 * scale);

    this.drawProps(ctx, left, right, time);
    const soil = ctx.createLinearGradient(0, 0, 0, h * .23 / scale);
    soil.addColorStop(0, '#323333');
    soil.addColorStop(.075, '#484949');
    soil.addColorStop(.25, '#767874');
    soil.addColorStop(.51, '#bbbdb7');
    soil.addColorStop(.78, '#e5e6e1');
    soil.addColorStop(1, '#f5f5f0');
    ctx.beginPath();
    for (let x = left - 10; x <= right + 10; x += 5) {
      const y = terrain(x);
      if (x === left - 10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(right + 10, h / scale); ctx.lineTo(left - 10, h / scale); ctx.closePath();
    ctx.fillStyle = soil; ctx.fill();

    // Sparse buried roots make the ground feel like a place rather than a line.
    ctx.strokeStyle = 'rgba(34,42,28,.08)'; ctx.lineWidth = .65;
    for (let i = Math.floor(left / 93); i <= Math.ceil(right / 93); i++) {
      const rng = random(i * 3499 + 4892);
      const x = i * 93 + rng() * 50;
      ctx.beginPath(); ctx.moveTo(x, terrain(x) + 7);
      ctx.bezierCurveTo(x - 9, 27, x + 15, 42, x - 5, 66); ctx.stroke();
    }

    const altitude = Math.max(0, terrain(cat.x) - (cat.y + 42));
    ctx.save(); ctx.translate(cat.x, terrain(cat.x) + 1); ctx.scale(1, .13);
    const shadow = ctx.createRadialGradient(0, 0, 2, 0, 0, 65);
    shadow.addColorStop(0, `rgba(21,26,17,${.20 / (1 + altitude * .018)})`);
    shadow.addColorStop(1, 'rgba(21,26,17,0)');
    ctx.fillStyle = shadow; ctx.beginPath(); ctx.ellipse(0, 0, 65, 55, 0, 0, TAU); ctx.fill(); ctx.restore();
    cat.draw(ctx, { skeleton });

    for (const p of this.particles) {
      ctx.fillStyle = `rgba(133,143,118,${Math.max(0, p.life * .38)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * (1.7 - p.life), 0, TAU); ctx.fill();
    }

    this.drawGrass(ctx, left, right, time);
    ctx.restore();

    // Wisps are deliberately subtle; the silhouette stays crisp and readable.
    this.mist(ctx, w * .18 + drift * 2, floor + 17, w * .42, 32 * scale, .10);
    this.mist(ctx, w * .8 - drift, floor + 19, w * .3, 21 * scale, .08);
  }

  drawProps(ctx, left, right) {
    for (let i = Math.floor(left / 440) - 1; i <= Math.ceil(right / 440); i++) {
      const rng = random(i * 4493 + 2877);
      const x = i * 440 + 210 + rng() * 90;
      const y = terrain(x) + 2;
      const width = 10 + rng() * 25;
      const height = 4 + rng() * 10;
      ctx.fillStyle = '#4b5043';
      ctx.beginPath();
      ctx.moveTo(x - width, y + 2);
      ctx.bezierCurveTo(x - width * .75, y - height, x - width * .22, y - height * .84, x, y - height);
      ctx.bezierCurveTo(x + width * .5, y - height * 1.22, x + width * .9, y - height * .3, x + width, y + 2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(219,226,207,.13)'; ctx.lineWidth = .65;
      ctx.beginPath(); ctx.moveTo(x - width * .6, y - height * .55); ctx.lineTo(x - width * .15, y - height * .8); ctx.lineTo(x + width * .5, y - height * .6); ctx.stroke();
    }
  }

  drawGrass(ctx, left, right, time) {
    const first = Math.floor(left / 17);
    const last = Math.ceil(right / 17);
    for (let i = first; i <= last; i++) {
      const rng = random(i * 2459 + 3887);
      if (rng() > .49) continue;
      const x = i * 17 + rng() * 12;
      const y = terrain(x) + 2;
      const tall = rng() > .87;
      const height = tall ? 19 + rng() * 19 : 3 + rng() * 8;
      const wind = this.reducedMotion ? 0 : Math.sin(time * .7 + x * .011) * height * .055;
      ctx.strokeStyle = tall ? '#494e40' : '#34392e';
      ctx.lineWidth = tall ? .55 : .65;
      ctx.lineCap = 'round';
      const count = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < count; j++) {
        const spread = (rng() - .5) * height * .9;
        const tipY = y - height * (.4 + rng() * .6);
        ctx.beginPath(); ctx.moveTo(x + (rng() - .5) * 5, y);
        ctx.quadraticCurveTo(x + spread * .25, tipY + height * .35, x + spread + wind, tipY);
        ctx.stroke();
        if (tall && j === 0) {
          ctx.fillStyle = '#53594a'; ctx.beginPath(); ctx.ellipse(x + spread + wind, tipY - 1, .9, 2.5, -.25, 0, TAU); ctx.fill();
        }
      }
    }
  }
}

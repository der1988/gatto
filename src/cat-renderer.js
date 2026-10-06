const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const INK = '#15191a';
const FAR_INK = '#333839';

function smoothPath(ctx, points) {
  for (let i = 0; i < points.length - 1; i++) {
    const next = points[i + 1];
    ctx.quadraticCurveTo(points[i].x, points[i].y, (points[i].x + next.x) / 2, (points[i].y + next.y) / 2);
  }
  if (points.length) ctx.lineTo(points.at(-1).x, points.at(-1).y);
}

// A tapered skin envelope follows the articulated bones, so silhouette and
// anatomical overlay share the same pose, including the photographic gallop.
function envelope(ctx, nodes, radii, color) {
  const a = [], b = [];
  for (let i = 0; i < nodes.length; i++) {
    const previous = nodes[Math.max(0, i - 1)];
    const next = nodes[Math.min(nodes.length - 1, i + 1)];
    const angle = Math.atan2(next.y - previous.y, next.x - previous.x) + Math.PI / 2;
    a.push({ x: nodes[i].x + Math.cos(angle) * radii[i], y: nodes[i].y + Math.sin(angle) * radii[i] });
    b.push({ x: nodes[i].x - Math.cos(angle) * radii[i], y: nodes[i].y - Math.sin(angle) * radii[i] });
  }
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(a[0].x, a[0].y);
  smoothPath(ctx, a.slice(1)); smoothPath(ctx, b.reverse());
  ctx.closePath(); ctx.fill();
}

function drawLeg(ctx, leg) {
  const { root, joint, ankle, paw } = leg.pose;
  const color = leg.far ? FAR_INK : INK;
  const radii = leg.kind === 'hind' ? [7.1, 4.1, 2.15, 1.85] : [4.6, 3.1, 1.95, 1.8];
  envelope(ctx, [root, joint, ankle, paw], radii, color);
  ctx.fillStyle = color;
  ctx.beginPath();
  const footAngle = leg.stance ? 0 : (leg.pose.footRotation ?? 0);
  ctx.ellipse(paw.x + Math.cos(footAngle) * 1.4, paw.y - .6, 3.7, 1.85, footAngle, 0, TAU);
  ctx.fill();
}

function drawBody(ctx, pose) {
  const { hip, shoulder, base = 0 } = pose;
  const arch = pose.spineArch ?? Math.max(0, pose.flex || 0);
  const mid = (hip.x + shoulder.x) / 2;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(hip.x - 9.5, hip.y - 1);
  ctx.bezierCurveTo(hip.x - 12, hip.y - 14.5, mid - 13, base - 13 - arch, mid + 2, base - 11.5 - arch * .7);
  ctx.bezierCurveTo(mid + 15, base - 11 - arch * .3, shoulder.x + 7, shoulder.y - 13, shoulder.x + 12, shoulder.y - 3);
  ctx.bezierCurveTo(shoulder.x + 13, shoulder.y + 3, shoulder.x + 9, shoulder.y + 12, shoulder.x + 1, shoulder.y + 12);
  ctx.bezierCurveTo(mid + 6, base + 12, mid - 2, base + 5.5 - arch * .22, hip.x + 5, hip.y + 9);
  ctx.bezierCurveTo(hip.x - 1, hip.y + 14, hip.x - 12, hip.y + 11, hip.x - 9.5, hip.y - 1);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hip.x - .4, hip.y + 1, 8.7, 9.5, -.25, 0, TAU);
  ctx.ellipse(shoulder.x + .5, shoulder.y + 1, 7.1, 9.8, .14, 0, TAU);
  ctx.fill();

  // Low-contrast muscle contours keep the figure dark while avoiding a flat
  // cut-out; no baked sprite is stretched when the spine changes length.
  ctx.strokeStyle = 'rgba(204,213,204,.055)'; ctx.lineWidth = .65;
  ctx.beginPath();
  ctx.moveTo(hip.x - 5, hip.y - 4);
  ctx.quadraticCurveTo(hip.x + 7, hip.y - 10, hip.x + 4, hip.y + 5);
  ctx.moveTo(shoulder.x - 3, shoulder.y - 7);
  ctx.quadraticCurveTo(shoulder.x - 8, shoulder.y + 1, shoulder.x - 3, shoulder.y + 8);
  ctx.stroke();
}

function drawHead(ctx, pose, time, idle) {
  const { shoulder, neck, head } = pose;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y - 10);
  ctx.bezierCurveTo(neck.x - 5, neck.y - 9, head.x - 7, head.y - 9, head.x + 1, head.y - 8.5);
  ctx.quadraticCurveTo(head.x + 8.5, head.y - 8, head.x + 9.3, head.y - 2.5);
  ctx.lineTo(head.x + 13, head.y + .1);
  ctx.quadraticCurveTo(head.x + 14.3, head.y + 1.6, head.x + 11.1, head.y + 3.1);
  ctx.quadraticCurveTo(head.x + 10.8, head.y + 7.2, head.x + 4.5, head.y + 8.1);
  ctx.quadraticCurveTo(head.x - 1.6, head.y + 9.9, head.x - 7.5, head.y + 5.3);
  ctx.bezierCurveTo(neck.x - 1, neck.y + 7, shoulder.x + 8, shoulder.y + 9, shoulder.x + 1, shoulder.y + 8);
  ctx.closePath(); ctx.fill();

  // Smaller ears and short rounded muzzle follow the proportions of the
  // reference cat; the head stays low and level during extension.
  ctx.beginPath();
  ctx.moveTo(head.x - 8.4, head.y - 4.8);
  ctx.quadraticCurveTo(head.x - 10, head.y - 9.2, head.x - 8.2, head.y - 17);
  ctx.quadraticCurveTo(head.x - 3.1, head.y - 14.3, head.x - 1.9, head.y - 7.1);
  ctx.moveTo(head.x + .3, head.y - 6.8);
  ctx.quadraticCurveTo(head.x + 2.3, head.y - 12.6, head.x + 6.6, head.y - 15.6);
  ctx.quadraticCurveTo(head.x + 8, head.y - 10.1, head.x + 6.8, head.y - 5.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(195,202,190,.14)'; ctx.lineWidth = .6;
  ctx.beginPath(); ctx.moveTo(head.x - 7.3, head.y - 13.5); ctx.lineTo(head.x - 4.4, head.y - 7.8); ctx.stroke();

  const blink = !idle && Math.sin(time * .83) > .9994;
  ctx.fillStyle = '#d8ddcb';
  ctx.beginPath(); ctx.ellipse(head.x + 6.9, head.y - 1.8, 1.15, blink ? .12 : .65, -.11, 0, TAU); ctx.fill();
  if (!blink) { ctx.fillStyle = INK; ctx.fillRect(head.x + 6.9, head.y - 2.5, .32, 1.3); }

  ctx.strokeStyle = 'rgba(29,35,34,.53)'; ctx.lineWidth = .5;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(head.x + 9, head.y + 3.4);
    ctx.quadraticCurveTo(head.x + 15, head.y + i * 2 - 1.2, head.x + 20.2, head.y + i * 2 - 1.9);
  }
  ctx.stroke();
}

function spineAt(pose, t) {
  const { hip, shoulder, base = 0 } = pose;
  const arch = pose.spineArch ?? Math.max(0, pose.flex || 0);
  return {
    x: lerp(hip.x - 2, shoulder.x, t),
    y: lerp(hip.y - 5, shoulder.y - 6, t) - Math.sin(t * Math.PI) * (3 + arch * .7) + (base - (hip.y + shoulder.y) / 2) * .1,
  };
}

function joint(ctx, p, r = 1.25) {
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
}

function drawSkeleton(ctx, cat) {
  const pose = cat.pose;
  const { hip, shoulder, neck, head, tail } = pose;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = '#e5c789';
  ctx.lineWidth = .9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const leg of cat.legs) {
    const { root, joint: knee, ankle, paw } = leg.pose;
    ctx.globalAlpha = leg.far ? .38 : .92;
    ctx.beginPath(); ctx.moveTo(root.x, root.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(ankle.x, ankle.y); ctx.lineTo(paw.x + 2, paw.y); ctx.stroke();
    for (const p of [root, knee, ankle]) joint(ctx, p);
  }
  ctx.globalAlpha = .9;
  ctx.beginPath();
  for (let i = 0; i <= 18; i++) {
    const p = spineAt(pose, i / 18);
    if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.quadraticCurveTo(neck.x, neck.y - 4, head.x - 1, head.y); ctx.stroke();
  for (let i = 0; i < 11; i++) joint(ctx, spineAt(pose, i / 10), .8);
  ctx.globalAlpha = .57;
  for (let i = 0; i < 6; i++) {
    const p = spineAt(pose, .52 + i * .062);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.bezierCurveTo(p.x + 4, p.y + 4, p.x + 5, shoulder.y + 9, p.x, shoulder.y + 10); ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(hip.x, hip.y, 5.5, 4, -.3, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(shoulder.x - 6, shoulder.y - 9); ctx.lineTo(shoulder.x + 2, shoulder.y - 6); ctx.lineTo(shoulder.x, shoulder.y + 1); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(head.x + 1, head.y, 7.8, 6.3, -.12, 0, TAU); ctx.moveTo(head.x + 8, head.y + 2); ctx.lineTo(head.x + 11, head.y + 3); ctx.stroke();
  ctx.globalAlpha = .52;
  ctx.beginPath(); ctx.moveTo(tail[0].x, tail[0].y); smoothPath(ctx, tail.slice(1)); ctx.stroke();
  for (const p of tail.slice(1)) joint(ctx, p, .6);
  ctx.restore();
}

export function drawCat(ctx, cat, { skeleton = false } = {}) {
  ctx.save();
  ctx.translate(cat.x, cat.y);
  ctx.scale(cat.facing * cat.size, cat.size);
  const nodes = cat.pose.tail;
  envelope(ctx, nodes, nodes.map((_, i) => lerp(3.1, .65, i / (nodes.length - 1))), INK);
  for (const leg of cat.legs.filter(l => l.far)) drawLeg(ctx, leg);
  drawBody(ctx, cat.pose);
  for (const leg of cat.legs.filter(l => !l.far)) drawLeg(ctx, leg);
  drawHead(ctx, cat.pose, cat.time, cat.grounded && Math.abs(cat.vx) < 1);
  if (skeleton) drawSkeleton(ctx, cat);
  ctx.restore();
}

/* CSI Lab · home hero (#inicio): the lab's fingerprint mark rebuilt live as a small neural network. Canvas 2D, ES
 * module, no dependencies; markup views/partials/home-hero.njk, layout css/pages/hero.css. The SVG's hidden
 * [data-hero-source] path shares the path and transform of favicon.svg: it is rasterised once and seeded points on its
 * ridge centre lines are linked into chains (the visible still is a frame of these chains). They assemble from the
 * core outwards, red signals leave the ridge endings (minutiae) and run inwards, a scan line passes every 7 s, a fine
 * pointer pushes points aside. [data-hero-avoid="<alpha>"] caps the alpha behind text. .hero gets .is-live after the
 * first frame; until then (no JS or canvas, any error) the still shows. The loop runs only on screen, in a visible
 * tab and without reduced motion (which gets one still frame). */

const SEED = 20080512;
const LEVELS = 6;                                        // brightness levels: one path per level and kind
// canvas colours are token values: --fg #f5f5f6, --red-200 #ff8f95, --red-300 #ff5a63, --red-400 #e0323f, --red-500 #b3172a
const GLOW = [[0, 'rgba(255, 143, 149, 1)'], [0.2, 'rgba(224, 50, 63, .45)'], [1, 'rgba(179, 23, 42, 0)']];
const TAIL = [[0, 'rgba(224, 50, 63, 0)'], [1, 'rgba(255, 90, 99, 1)']];
const HAZE = [[0, 'rgba(224, 50, 63, 0)'], [0.5, 'rgba(224, 50, 63, .14)'], [1, 'rgba(224, 50, 63, 0)']];
const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // Park–Miller
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const nextTask = () => new Promise((resolve) => setTimeout(resolve));
const onChange = (query, fn) => (query.addEventListener ? query.addEventListener('change', fn) : query.addListener(fn));
const addStops = (gradient, stops) => stops.reduce((g, [at, color]) => (g.addColorStop(at, color), g), gradient);
const capAt = (x0, y0, x1 = x0, y1 = y0) =>              // the lowest alpha cap among the text boxes touched
  avoid.reduce((cap, b) => (b.x0 < x1 && b.x1 > x0 && b.y0 < y1 && b.y1 > y0 ? Math.min(cap, b.cap) : cap), 1);
const guard = (fn) => (...args) => {
  try {
    if (!failed) fn(...args);
  } catch (error) {
    fail(error);
  }
};

const hero = document.querySelector('[data-hero]');
const canvas = hero && hero.querySelector('[data-hero-canvas]');
const mark = hero && hero.querySelector('[data-hero-mark]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const random = seeded(SEED + 1);                         // signal timing; the layout has its own stream
const view = { width: 0, height: 0, dpr: 1, unit: 1, x: 0, y: 0, size: 1, print: 0, left: 0, right: 0 };
const pointer = { x: 0, y: 0, active: false };
let ctx, glow, net, ratioQuery, avoid = [], pulses = [];
let time = 0, last = 0, raf = 0, nextPulse = 1.4, scanY = 0, scanLight = 0;
let onScreen = true, live = false, failed = false;

/* ---- setup, in three short tasks: SVG path → raster → ridge centre lines → seeded points → chains ---- */
function rasterise() {
  const vb = mark.viewBox.baseVal;
  const path = mark.querySelector('[data-hero-source]');
  const list = path.parentNode.transform.baseVal;        // favicon.svg's <g transform> chain
  const chain = new DOMMatrix();
  for (let i = 0; i < list.numberOfItems; i++) chain.multiplySelf(list.getItem(i).matrix);
  const scale = 256 / vb.width;                          // raster pixels per viewBox unit
  const w = Math.round(vb.width * scale);
  const sheet = Object.assign(document.createElement('canvas'), { width: w, height: Math.round(vb.height * scale) });
  const g = sheet.getContext('2d', { willReadFrequently: true });
  g.setTransform(new DOMMatrix([scale, 0, 0, scale, -vb.x * scale, -vb.y * scale]).multiply(chain));
  Object.assign(g, { lineWidth: 3, lineJoin: 'round' }); // as in favicon.svg: fill + 3-unit stroke
  const shape = new Path2D(path.getAttribute('d'));
  g.fill(shape);
  g.stroke(shape);
  const alpha = g.getImageData(0, 0, w, sheet.height).data;
  const dist = new Uint16Array(alpha.length / 4).map((_, i) => (alpha[i * 4 + 3] > 127 ? 9999 : 0));
  for (let i = w + 1; i < dist.length - w - 1; i++) {    // chamfer distance to the background: 3 straight, 4 diagonal
    dist[i] &&= Math.min(dist[i], dist[i - 1] + 3, dist[i - w] + 3, dist[i - w - 1] + 4, dist[i - w + 1] + 4);
  }
  for (let i = dist.length - w - 2; i > w; i--) {
    dist[i] &&= Math.min(dist[i], dist[i + 1] + 3, dist[i + w] + 3, dist[i + w + 1] + 4, dist[i + w - 1] + 4);
  }
  const centre = [];                                     // centre lines: (near) local maxima of the distance
  for (let i = 2 * w, d; i < dist.length - 2 * w; i++) {
    if ((d = dist[i] + 1) > 4 && d >= dist[i - 1] && d >= dist[i + 1] && d >= dist[i - w] && d >= dist[i + w] &&
      d >= dist[i - w - 1] && d >= dist[i - w + 1] && d >= dist[i + w - 1] && d >= dist[i + w + 1]) centre.push(i);
  }
  if (centre.length < 100) throw new Error('the mark could not be sampled');
  return { w, scale, vb, dist, centre };
}

function sample({ w, scale, vb, dist, centre }, budget) {
  const rand = seeded(SEED);                             // a seeded order: the same layout on every load
  const order = centre.map((c) => [rand(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const pick = (r) => {                                  // dart throwing: every kept pixel claims a disc of radius r
    const taken = new Uint8Array(dist.length);
    return order.filter((c) => {
      if (taken[c]) return false;
      for (let j = -Math.ceil(r); j <= r; j++) {
        for (let i = -Math.ceil(r); i <= r; i++) if (i * i + j * j < r * r) taken[c + j * w + i] = 1;
      }
      return true;
    });
  };
  const radius = Math.max(1.6, (4 * pick(4).length) / budget);   // along a line, count ≈ length / spacing
  const points = pick(radius).map((c) => {
    let sx = 0, sy = 0, sum = 0;                         // pull to the distance-weighted centre of its 5 × 5 window
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const weight = dist[c + j * w + i] ** 2;
        [sx, sy, sum] = [sx + i * weight, sy + j * weight, sum + weight];
      }
    }
    return { x: vb.x + ((c % w) + 0.5 + sx / sum) / scale, y: vb.y + (Math.floor(c / w) + 0.5 + sy / sum) / scale };
  });
  return { points, spacing: radius / scale, rand };
}

function connect({ points, spacing, rand }, { w, scale, vb, dist }) {
  const [cx, cy, reach] = [vb.x + vb.width / 2, vb.y + vb.height / 2, vb.height / 2];
  const [links, neighbours] = [[], points.map(() => [])];
  const link = (i, j) => neighbours[i].includes(j) || (links.push(i, j), neighbours[i].push(j), neighbours[j].push(i));
  const inRidge = (x, y) => dist[Math.round((y - vb.y) * scale) * w + Math.round((x - vb.x) * scale)] > 0;
  points.forEach((p, i) => {                             // the nearest point, then the nearest on the other side,
    const near = [];                                     // never across the gap between two ridges
    points.forEach((q, j) => {
      const d = Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2);
      const ok = j !== i && d < 2.4 * spacing && inRidge((p.x + q.x) / 2, (p.y + q.y) / 2);
      if (ok) near.push({ j, d, dx: q.x - p.x, dy: q.y - p.y });
    });
    near.sort((a, b) => a.d - b.d);
    const across = near.find((q) => q.dx * near[0].dx + q.dy * near[0].dy < -0.2 * q.d * near[0].d);
    if (near.length) link(i, near[0].j);
    if (across) link(i, across.j);
  });
  const minutiae = neighbours.flatMap((around, i) => {   // ridge endings: chain ends, ticked along their ridge
    if (around.length !== 1) return [];
    const inner = points[neighbours[around[0]].find((j) => j !== i) ?? around[0]];
    const d = Math.hypot(points[i].x - inner.x, points[i].y - inner.y) || 1;
    return [{ node: i, dx: (points[i].x - inner.x) / d, dy: (points[i].y - inner.y) / d }];
  });
  for (const p of points) {
    const r = Math.min(1, Math.hypot(p.x - cx, p.y - cy) / reach);
    Object.assign(p, { r: r * reach, angle: Math.atan2(p.y - cy, p.x - cx), base: (0.62 + 0.24 * rand()) * (1 - 0.2 * r * r),
      size: 0.85 + 0.3 * rand(), phase: 7 * rand(), delay: 0.5 * r + 0.15 * rand(), duration: 1 + 0.4 * rand(),
      from: 0.25 + 0.45 * rand(), swirl: 0.4 + 0.5 * rand(), cap: 1, fire: 0, ox: 0, oy: 0, px: 0, py: 0 });
  }
  const formed = Math.max(...points.map((p) => p.delay + p.duration));
  return { points, links, neighbours, minutiae, cx, cy, top: vb.y, height: vb.height, formed };
}

/* ---- every frame ---- */
function spawnPulse() {                                  // a signal leaves a ridge ending, inwards (lengths in links)
  const origin = net.minutiae[Math.floor(random() * net.minutiae.length)];
  const path = [origin.node];
  for (let next = [0]; next.length && path.length < 40;) {
    next = net.neighbours[path[path.length - 1]].filter((j) => !path.includes(j));
    if (next.length) path.push(next[Math.floor(random() * next.length)]);
  }
  net.points[origin.node].fire = 1;                      // the ending flashes as the signal leaves
  if (path.length > 5) pulses.push({ path, head: 0, fired: 0, speed: 9 + 5 * random(), tail: 5 + 3 * random() });
}

function update(dt) {
  const { points, cx, cy, height } = net;
  time += dt;
  const sweep = time < 2.2 ? -1 : ((time - 2.2) % 7) / 2.4;   // the scan: top to bottom in 2.4 s, every 7 s
  scanLight = sweep >= 0 && sweep < 1 ? Math.sin(Math.PI * sweep) : 0;
  scanY = net.top + height * (1.12 * (0.5 - 0.5 * Math.cos(Math.PI * clamp01(sweep))) - 0.06);
  const decay = Math.exp(-dt * 1.4);
  const reach = 0.17 * height * view.unit;               // the pointer's radius
  for (const p of points) {
    const k = clamp01((time - p.delay) / p.duration);   // entrance: unfurls from a loose cloud round the core
    const r = p.r * (p.from + (1 - p.from) * (1 - (1 - k) ** 4));
    const angle = p.angle + p.swirl * (1 - k) ** 3;
    const x = cx + r * Math.cos(angle) + 0.0012 * height * k * Math.sin(time * 0.8 + p.phase);   // + slow breathing
    const y = cy + r * Math.sin(angle) + 0.0012 * height * k * Math.cos(time * 0.67 + p.phase);
    const lit = scanLight * Math.exp(-(((y - scanY) / (0.05 * height)) ** 2));
    const push = pointer.active ? Math.max(0, 1 - Math.hypot(p.px - pointer.x, p.py - pointer.y) / reach) ** 2 : 0;
    p.ox += ((p.px - pointer.x) * push * 0.7 - p.ox) * Math.min(1, dt * 8);   // a soft push aside, easing back
    p.oy += ((p.py - pointer.y) * push * 0.7 - p.oy) * Math.min(1, dt * 8);
    p.px = view.x + x * view.unit + p.ox;
    p.py = view.y + y * view.unit + p.oy;
    const shimmer = 0.08 * Math.sin(time * 0.6 - (p.x + p.y) * 0.018);   // + the scan's light and the pointer's
    p.light = Math.min(1.3, p.base + shimmer + 0.8 * lit + push) * clamp01(0.25 + 2 * k) * p.cap;
    p.linked = clamp01((k - 0.55) / 0.45) ** 2;
    p.fire *= decay;
  }
  if (time > nextPulse && time > net.formed - 0.5) {
    if (pulses.length < (view.size < 0.9 ? 2 : 3)) spawnPulse();
    nextPulse = time + (0.5 + 0.9 * random()) * (view.size < 0.9 ? 1.5 : 1);
  }
  for (const u of pulses) u.head += u.speed * dt;
}

function drawPulse(u) {                                  // bright head, fading tail; false once it has gone
  const { points } = net;
  const end = u.path.length - 1;
  const [from, to] = [Math.max(0, u.head - u.tail), Math.min(end, u.head)];
  if (from >= end) return false;
  const k = Math.min(end - 1, Math.floor(to));           // the head, between two nodes
  const [a, b, tail] = [points[u.path[k]], points[u.path[k + 1]], points[u.path[Math.floor(from)]]];
  const [hx, hy] = [a.px + (b.px - a.px) * (to - k), a.py + (b.py - a.py) * (to - k)];
  ctx.beginPath();
  ctx.moveTo(tail.px, tail.py);
  for (let n = Math.floor(from) + 1; n <= k; n++) ctx.lineTo(points[u.path[n]].px, points[u.path[n]].py);
  ctx.lineTo(hx, hy);
  ctx.strokeStyle = addStops(ctx.createLinearGradient(tail.px, tail.py, hx, hy), TAIL);
  ctx.globalAlpha = 0.9 * capAt(hx, hy);
  ctx.stroke();
  for (; u.fired < Math.floor(to); u.fired++) points[u.path[u.fired + 1]].fire = 1;   // nodes fire as it passes
  if (u.head < end) ctx.drawImage(glow, hx - 11 * view.size, hy - 11 * view.size, 22 * view.size, 22 * view.size);
  return true;
}

function draw() {
  const { points, links, minutiae } = net;
  const paths = Array.from({ length: 2 * LEVELS }, () => new Path2D());   // links, then nodes, by brightness
  const level = (light, max) => Math.min(LEVELS - 1, Math.floor((light * LEVELS) / max));
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  for (let e = 0; e < links.length; e += 2) {
    const [a, b] = [points[links[e]], points[links[e + 1]]];
    const shown = Math.min(a.linked, b.linked);
    if (shown > 0) paths[level((a.light + b.light) * shown, 2.2)].moveTo(a.px, a.py);
    if (shown > 0) paths[level((a.light + b.light) * shown, 2.2)].lineTo(b.px, b.py);
  }
  for (const p of points) {
    const r = p.size * view.size * (0.7 + 0.25 * p.light);   // tiny squares: as round as dots at this size, cheaper
    paths[LEVELS + level(p.light, 1.2)].rect(p.px - r, p.py - r, 2 * r, 2 * r);
  }
  const ring = 3 * view.size;                            // the minutiae plot: ring + direction tick, with the links;
  for (const { node, dx, dy } of minutiae.filter((m) => points[m.node].linked > 0.9)) {
    const p = points[node];                              // a small print gets a bright node instead of the ring
    const path = paths[level(p.light, 1.3)];
    path.moveTo(p.px + ring, p.py);
    if (view.print < 260) paths[2 * LEVELS - 1].rect(p.px - 1.2, p.py - 1.2, 2.4, 2.4);
    else path.arc(p.px, p.py, ring, 0, 2 * Math.PI);
    path.moveTo(p.px + dx * ring, p.py + dy * ring);
    path.lineTo(p.px + dx * (ring + 5 * view.size), p.py + dy * (ring + 5 * view.size));
  }
  ctx.strokeStyle = ctx.fillStyle = '#f5f5f6';           // --fg
  ctx.lineWidth = view.dpr < 1.5 ? 1 : 0.75;
  paths.forEach((path, n) => {
    ctx.globalAlpha = (((n % LEVELS) + 1) / LEVELS) * (n < LEVELS ? 0.85 : 1);
    if (n < LEVELS) ctx.stroke(path);
    else ctx.fill(path);
  });
  ctx.globalCompositeOperation = 'lighter';              // red on top: fired nodes, signals, the scan line
  for (const p of points) {
    const s = (8 + 14 * p.fire) * view.size;
    ctx.globalAlpha = 0.6 * p.fire * p.cap;
    if (p.fire > 0.03) ctx.drawImage(glow, p.px - s / 2, p.py - s / 2, s, s);
  }
  ctx.lineWidth = 1.2 * view.size;
  pulses = pulses.filter(drawPulse);
  const y = view.y + scanY * view.unit;                  // the scan: a 1px line in a soft red haze, across the frame
  ctx.globalAlpha = scanLight * capAt(view.left, y - 24, view.right, y + 24);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, y - 24, 0, y + 24), HAZE);
  ctx.fillRect(view.left, y - 24, view.right - view.left, 48);
  ctx.fillStyle = 'rgba(255, 143, 149, .55)';
  ctx.fillRect(view.left, y - 0.5, view.right - view.left, 1);
  ctx.globalCompositeOperation = 'source-over';
}

const frame = guard((now) => {
  raf = requestAnimationFrame(frame);
  update(Math.min(0.05, Math.max(0, (now - last) / 1000)));
  last = now;
  draw();
});

/* ---- lifecycle ---- */
function layout() {                                      // canvas size, where the SVG still sits in it, text caps
  const [box, frameBox, area] = [canvas, canvas.parentNode, mark].map((el) => el.getBoundingClientRect());
  const vb = mark.viewBox.baseVal;
  const unit = Math.min(area.width / vb.width, area.height / vb.height);   // xMidYMid meet, like the SVG
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3e6 / Math.max(1, box.width * box.height)));
  Object.assign(view, { width: box.width, height: box.height, dpr, unit, left: frameBox.left - box.left,
    right: frameBox.right - box.left, print: vb.height * unit, size: Math.min(1.2, Math.max(0.75, (vb.height * unit) / 520)),
    x: area.left - box.left + (area.width - vb.width * unit) / 2 - vb.x * unit,
    y: area.top - box.top + (area.height - vb.height * unit) / 2 - vb.y * unit });
  Object.assign(canvas, { width: Math.round(box.width * dpr), height: Math.round(box.height * dpr) });
  avoid = [...hero.querySelectorAll('[data-hero-avoid]')].map((el) => {
    const r = el.getBoundingClientRect();
    const [x0, y0] = [r.left - box.left - 16, r.top - box.top - 16];
    return { x0, y0, x1: x0 + r.width + 32, y1: y0 + r.height + 32, cap: parseFloat(el.dataset.heroAvoid) || 0 };
  });
  for (const p of net.points) p.cap = capAt(view.x + p.x * view.unit, view.y + p.y * view.unit);
}

function render() {                                      // lay out and draw at once (resizing clears the canvas)
  layout();
  if (reducedMotion.matches) {      // a still: formed, between two scans, signals in flight
    time = 6.2 + 7 * Math.ceil(Math.max(0, time - 6.2) / 7);
    pulses = [];
    for (let i = 0; i < 3; i++) spawnPulse();
    for (const u of pulses) u.head = u.tail * (1.3 + 0.6 * random());
  }
  update(0);
  draw();
  if (live) return sync();
  live = true;
  hero.classList.add('is-live');
  sync();
}

function sync() {                                        // run only when seen and welcome
  const run = live && onScreen && !document.hidden && !reducedMotion.matches && !failed;
  if (run === Boolean(raf)) return;                      // already in that state
  last = performance.now();
  raf = run ? requestAnimationFrame(frame) : cancelAnimationFrame(raf) || 0;
}

function watchPixelRatio() {                             // sharp again after a move to another screen
  const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  ratioQuery = query;
  onChange(query, guard(() => query === ratioQuery && (render(), watchPixelRatio())));
}

function fail(error) {                                   // back to the static still, for good
  failed = true;
  cancelAnimationFrame(raf);
  hero.classList.replace('is-live', 'is-failed') || hero.classList.add('is-failed');
  console.warn('hero: showing the static mark.', error);
}

async function start() {                                 // a missing feature throws and leaves the still in place
  if (!canvas || !mark || !window.ResizeObserver || !window.IntersectionObserver) throw Error('unsupported');
  ctx = canvas.getContext('2d');
  glow = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });   // a sprite, never shadowBlur
  const g = glow.getContext('2d');
  g.fillStyle = addStops(g.createRadialGradient(32, 32, 0, 32, 32, 32), GLOW);
  g.fillRect(0, 0, 64, 64);
  const budget = Math.round(Math.min(560, Math.max(220, mark.getBoundingClientRect().height * 1.05)));   // ≈ 1 per px
  await nextTask();
  const raster = rasterise();
  await nextTask();
  const sampled = sample(raster, budget);
  await nextTask();
  net = connect(sampled, raster);
  const frameEl = canvas.parentNode;                     // the canvas overhangs the frame by view.left on every side
  new ResizeObserver(guard(render)).observe(frameEl);
  new IntersectionObserver(guard(([entry]) => (onScreen = entry.isIntersecting, sync()))).observe(frameEl);
  document.addEventListener('visibilitychange', guard(sync));
  onChange(reducedMotion, guard(() => (reducedMotion.matches ? render() : sync())));
  watchPixelRatio();
  hero.addEventListener('animationend', guard(render));  // the text has settled after its entrance
  frameEl.addEventListener('pointermove', (event) => Object.assign(pointer, {   // a fine pointer
    x: event.offsetX + view.left,
    y: event.offsetY + view.left,
    active: event.pointerType !== 'touch' && event.target === frameEl,
  }));
  frameEl.addEventListener('pointerleave', () => (pointer.active = false));
}

if (hero) start().catch(fail);

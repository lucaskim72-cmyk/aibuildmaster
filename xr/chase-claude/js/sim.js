// Deterministic chase simulation. Pure JS (no three.js), so the Node sound synth hears exactly the same events
// (overtakes, lane changes, drifts) that the renderer shows. Hero car stays at z = 0; the world scrolls toward +z.
// Forward is -z. Distances in metres, speeds in m/s.

export const LANE_W = 3.6, LANES = 6, DT = 1 / 120;
export const laneX = (i) => (i - (LANES - 1) / 2) * LANE_W;
export const ROAD_HALF = (LANES * LANE_W) / 2; // 10.8 m
export const HERO_LEN = 4.7, POLICE_LEN = 4.9;
const FRONT = -800, BACK = 95, SPAN = BACK - FRONT;
const HIST = 480; // 4 s of history at 120 Hz
const MAX_SPARKS = 900;

export function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Hero speed in km/h over time (300+ the whole way, ~320 in the first-person part, peaking near the end)
export function heroKmh(t) {
  if (t > 30) t = 26 + ((t - 26) % 8);
  return 299 + 21 * smooth(0, 9, t) + 13 * smooth(18, 26, t) + 2.6 * Math.sin(t * 1.27) + 1.2 * Math.sin(t * 3.3 + 1);
}

// Police gaps behind the hero (centre to centre, metres). They surge and fall back so CLOSING shows up.
const policeZ = [
  (t) => 9.6 + 3.4 * Math.sin(t * 0.62 + 0.3) + 1.1 * Math.sin(t * 1.7),
  (t) => 17.5 + 4.2 * Math.sin(t * 0.45 + 2.1) + 1.0 * Math.sin(t * 1.3 + 0.5),
];

// Where the hero would like to be (makes it weave across all six lanes even when the road is clear)
const HERO_PREF = [[0, 2], [2.6, 4], [5.4, 1], [8.6, 3], [11.2, 2], [16.4, 4], [19.6, 1], [22.6, 3], [25.4, 2]];
const heroPref = (t) => { const tt = t > 30 ? (t - 26) % 26 : t; let p = 2; for (const [a, l] of HERO_PREF) if (tt >= a) p = l; return p; };

const LANE_SPEED = [34.5, 32.5, 30.5, 28.5, 26.0, 23.5]; // left lanes faster; all cars in a lane share speed, so they never overlap
const PAINT = [0x2a2f38, 0x8a8f98, 0xd8dce2, 0x1d2a44, 0x5a1c22, 0x23362d, 0x101114, 0x6b5a48, 0x37465c, 0xb9bec7];

// Public entry: a simulation whose first 31 s are collision-free. The world is deterministic, so we run it once,
// drop the few traffic cars that the chase could not dodge, and run again (converges in a few passes, ~0.2 s).
const cleanCache = new Map();
export function createSim(seed = 11) {
  if (!cleanCache.has(seed)) {
    const exclude = new Set();
    for (let pass = 0; pass < 12; pass++) {
      const probe = rawSim(seed, exclude);
      probe.advanceTo(31);
      if (!probe.state.hitIds.size) break;
      for (const id of probe.state.hitIds) exclude.add(id);
    }
    cleanCache.set(seed, exclude);
  }
  return rawSim(seed, cleanCache.get(seed));
}

function rawSim(seed, exclude) {
  const R = mulberry(seed);
  let traffic = [];
  for (let lane = 0; lane < LANES; lane++) {
    let z = FRONT + R() * 60;
    while (z < BACK - 30) {
      const kr = R();
      const kind = lane >= 4 && kr < 0.35 ? 'truck' : kr < 0.2 ? 'van' : 'car';
      const len = kind === 'truck' ? 11.5 : kind === 'van' ? 5.3 : 4.6;
      const w = kind === 'truck' ? 2.5 : kind === 'van' ? 2.0 : 1.86;
      const h = kind === 'truck' ? 3.7 : kind === 'van' ? 2.1 : 1.45;
      traffic.push({ id: traffic.length, lane, x: laneX(lane), z0: z, z, len, w, h, kind, paint: PAINT[(R() * PAINT.length) | 0], v: LANE_SPEED[lane], prevZ: z });
      z += 125 + R() * 140 + (lane >= 4 ? 30 : 0);
    }
  }
  traffic = traffic.filter((c) => !exclude.has(c.id));
  // keep a clear pocket around the hero and police at t = 0
  for (const c of traffic) if (c.z0 > -60 && c.z0 < 40) c.z0 -= 140;

  const hist = { t: new Float64Array(HIST), s: new Float64Array(HIST), x: new Float64Array(HIST), yaw: new Float64Array(HIST), roll: new Float64Array(HIST), ax: new Float64Array(HIST),
    p0x: new Float64Array(HIST), p0z: new Float64Array(HIST), p1x: new Float64Array(HIST), p1z: new Float64Array(HIST), head: -1, count: 0 };

  const mkAgent = (lane, z, trig) => ({ lane, x: laneX(lane), vx: 0, ax: 0, z, yaw: 0, roll: 0, cool: 0, trig, gap: 999, dz: 0, closing: false });
  const S = {
    t: 0, s: 0, v: heroKmh(0) / 3.6, kmh: heroKmh(0),
    hero: mkAgent(2, 0, 150),
    police: [mkAgent(2, policeZ[0](0), 140), mkAgent(3, policeZ[1](0), 140)],
    traffic, sparks: [], events: [], hist, minSep: 99, collisions: 0, hitIds: new Set(),
  };
  const sparkPool = [];
  for (let i = 0; i < MAX_SPARKS; i++) sparkPool.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 0, px: 0, py: 0, pz: 0 });
  S.sparks = sparkPool;
  let sparkHead = 0, sparkAcc = 0;

  function placeTraffic() {
    for (const c of traffic) {
      c.prevZ = c.z;
      const p = c.z0 + S.s - c.v * S.t;
      c.z = FRONT + ((((p - FRONT) % SPAN) + SPAN) % SPAN);
    }
  }
  placeTraffic();
  for (const c of traffic) c.prevZ = c.z;

  // bumper-to-bumper gap ahead in a lane for an agent at z (negative: something beside us)
  function gapAhead(lane, z, len) {
    let best = 1e9;
    for (const c of traffic) {
      if (c.lane !== lane) continue;
      const d = z - c.z, half = (c.len + len) / 2;
      if (d > -half - 2.5) best = Math.min(best, d - half);
    }
    return best;
  }

  function drive(a, pref, len, isHero) {
    const cur = a.lane;
    const g = gapAhead(cur, a.z, len);
    a.gap = g;
    a.cool -= DT;
    let want = cur;
    if (g < a.trig) {
      let best = -1, bestScore = g + 14;
      for (const L of [cur - 1, cur + 1]) {
        if (L < 0 || L >= LANES) continue;
        const gl = gapAhead(L, a.z, len);
        const score = gl + (L === pref ? 18 : 0) - Math.abs(L - pref) * 3;
        if (gl > 28 && score > bestScore) { bestScore = score; best = L; }
      }
      if (best >= 0) want = best;
    } else if (pref !== cur && a.cool <= 0) {
      const L = cur + Math.sign(pref - cur);
      if (gapAhead(L, a.z, len) > 120) want = L;
    }
    if (want !== cur && (a.cool <= 0 || g < 75)) {
      a.lane = want; a.cool = isHero ? 0.85 : 1.1;
      if (isHero) S.events.push({ t: S.t, type: 'lane', dir: Math.sign(want - cur), gap: g });
    }
    const tx = laneX(a.lane);
    const k = isHero ? 8.5 : 6.5, c = 2 * Math.sqrt(k) * 0.78;
    a.ax = Math.max(-32, Math.min(32, k * (tx - a.x) - c * a.vx));
    a.vx += a.ax * DT;
    a.x += a.vx * DT;
    const yawT = -Math.atan2(a.vx * (isHero ? 2.35 : 1.5), S.v);
    a.yaw += (yawT - a.yaw) * Math.min(1, DT * 11);
    const rollT = Math.max(-0.11, Math.min(0.11, a.ax * 0.0048));
    a.roll += (rollT - a.roll) * Math.min(1, DT * 7);
  }

  function spawnSparks() {
    const h = S.hero, slide = Math.abs(h.vx);
    const rate = slide > 2.2 ? (slide - 2.2) * 150 + (Math.abs(h.ax) > 14 ? 120 : 0) : 0;
    sparkAcc += rate * DT;
    const cy = Math.cos(h.yaw), sy = Math.sin(h.yaw);
    while (sparkAcc >= 1) {
      sparkAcc -= 1;
      const p = sparkPool[sparkHead]; sparkHead = (sparkHead + 1) % MAX_SPARKS;
      const side = h.vx > 0 ? -1 : 1; // the outer rear wheel scrapes
      const lx = side * (0.78 + R() * 0.2), lz = 1.35 + R() * 0.35;
      p.x = h.x + lx * cy + lz * sy; p.z = h.z - lx * sy + lz * cy; p.y = 0.04 + R() * 0.06;
      p.vx = side * (2 + R() * 6) - h.vx * 0.4; p.vy = 1.2 + R() * 4.2; p.vz = 14 + R() * 26;
      p.age = 0; p.life = 0.22 + R() * 0.38; p.alive = true;
      p.px = p.x; p.py = p.y; p.pz = p.z;
    }
  }
  function stepSparks() {
    for (const p of sparkPool) {
      if (!p.alive) continue;
      p.age += DT;
      if (p.age > p.life) { p.alive = false; continue; }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.vy -= 9.8 * DT;
      p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
      if (p.y < 0.01) { p.y = 0.01; p.vy = -p.vy * 0.32; p.vx *= 0.7; }
    }
  }

  function record() {
    const H = hist; H.head = (H.head + 1) % HIST; H.count = Math.min(HIST, H.count + 1);
    const i = H.head;
    H.t[i] = S.t; H.s[i] = S.s; H.x[i] = S.hero.x; H.yaw[i] = S.hero.yaw; H.roll[i] = S.hero.roll; H.ax[i] = S.hero.ax;
    H.p0x[i] = S.police[0].x; H.p0z[i] = S.police[0].z; H.p1x[i] = S.police[1].x; H.p1z[i] = S.police[1].z;
  }

  function step() {
    S.t += DT;
    S.kmh = heroKmh(S.t);
    S.v = S.kmh / 3.6;
    S.s += S.v * DT;
    placeTraffic();
    // overtakes (a car crossing the hero's nose line) -> whoosh in the sound
    for (const c of traffic) if (c.prevZ < 0 && c.z >= 0 && c.z - c.prevZ < 5) S.events.push({ t: S.t, type: 'pass', side: Math.sign(c.x - S.hero.x), dx: Math.abs(c.x - S.hero.x), kind: c.kind });
    drive(S.hero, heroPref(S.t), HERO_LEN, true);
    const hl = Math.round((S.hero.x / LANE_W) + (LANES - 1) / 2);
    for (let i = 0; i < 2; i++) {
      const p = S.police[i];
      const nz = policeZ[i](S.t);
      p.dz = (nz - p.z) / DT; p.z = nz; p.closing = p.dz < -0.15;
      let pref = Math.max(0, Math.min(LANES - 1, hl + (i === 0 ? 0 : hl >= 3 ? -1 : 1)));
      if (i === 1 && pref === S.police[0].lane) pref = Math.max(0, Math.min(LANES - 1, pref + (pref >= 3 ? -1 : 1)));
      drive(p, pref, POLICE_LEN, false);
    }
    spawnSparks(); stepSparks();
    // safety bookkeeping (should never report a hit)
    for (const a of [S.hero, ...S.police]) for (const c of traffic) {
      const dz = Math.abs(a.z - c.z) - (c.len + HERO_LEN) / 2, dx = Math.abs(a.x - c.x) - (c.w + 1.95) / 2;
      if (dz < 0) { S.minSep = Math.min(S.minSep, dx); if (dx < 0) { S.collisions++; S.hitIds.add(c.id); } }
    }
    record();
  }

  // going back in time = start over (30 s of simulation takes a few milliseconds). Always read sim.state afterwards.
  function reset() { Object.assign(api, rawSim(seed, exclude)); }
  function advanceTo(t) {
    if (t < S.t - 1e-6) { reset(); return api.advanceTo(t); }
    while (S.t + DT <= t + 1e-9) step();
    return S;
  }
  // history sample `ago` seconds back (clamped to what we have)
  function history(ago) {
    const H = hist; if (H.count === 0) return null;
    const back = Math.min(H.count - 1, Math.max(0, Math.round(ago / DT)));
    const i = (H.head - back + HIST) % HIST;
    return { t: H.t[i], s: H.s[i], x: H.x[i], yaw: H.yaw[i], roll: H.roll[i], ax: H.ax[i], p0x: H.p0x[i], p0z: H.p0z[i], p1x: H.p1x[i], p1z: H.p1z[i] };
  }
  const api = { state: S, step, reset, advanceTo, history };
  return api;
}

// The obstacle the hero is heading for: nearest car ahead in the hero's path (used by HUD and copilot)
export function nearestObstacle(S, range = 170) {
  let best = null;
  const h = S.hero;
  for (const c of S.traffic) {
    const ahead = h.z - c.z - (c.len + HERO_LEN) / 2;
    if (ahead < 3 || ahead > range) continue;
    const inPath = Math.abs(c.x - h.x) < 2.6 || c.lane === h.lane;
    if (!inPath) continue;
    if (!best || ahead < best.dist) best = { car: c, dist: ahead };
  }
  return best;
}

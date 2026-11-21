// 토리 길 찾기 실험실 — 계산 핵심 (화면 없음 · 워커 · Node 공용)
// 연습장 = microduck_rl/scripts/hamster/tori_nav2d.py 를 그대로 옮김 (11-12 teacher_v2 와 같은 관찰 48 · 명령 10 · 보상).
// 학습 = PPO (GAE 0.99/0.95 · clip 0.2 · 엔트로피 · Adam · 기울기 자르기 1.0) 를 순수 JS 로.

// ---------- 상수 (tori_nav2d.py 와 같음) ----------
export const ACT_NAMES = ["앞", "앞+왼돌기", "앞+오른돌기", "앞+왼옆", "앞+오른옆", "왼옆걸음", "오른옆걸음", "왼쪽 돌기", "오른쪽 돌기", "멈춤"];
export const ACT_ICONS = ["↑", "↖", "↗", "⇖", "⇗", "←", "→", "⟲", "⟳", "■"];
// 명령별 실제 반응 (nav_cmd_probe.json, 11-12 실측) vx, vy, wz
export const REAL = [[0.20, 0, 0], [0.20, 0, 0.34], [0.20, 0, -0.38], [0.155, 0.08, 0], [0.155, -0.085, 0],
  [0, 0.087, 0], [0, -0.095, 0], [0.01, 0, 0.92], [0.01, 0, -0.88], [0, 0, 0]];
export const NA = 10;
export const DT_DEC = 0.2, DT_SIM = 0.05, TAU = 0.30;
export const R_BODY = 0.11, R_WARN = 0.18;
export const K_OBJ = 5, M_MAX = 9;
export const T_MAX = 30.0;
export const OBS_DIM = 2 + 2 + 3 + NA + K_OBJ * 6 + 1;   // 48
export const LANE_HALF = 0.7, GOAL_HALF = 0.3;
// 점수 규칙 기본값 (= tori_nav2d.py 와 같음). 화면 '학습 조건'에서 바꿀 수 있음.
export const REW_DEFAULT = {
  prog: 5.0,    // 깃발에 가까워진 거리(m) × 이 값
  time: 0.02,   // 걸음마다 시간 감점
  lane: 0.06,   // 길 가운데서 벗어남 감점
  near: 0.6,    // 딱딱한 물건 18 cm 안 감점
  soft: 0.08,   // 양말·손수건 밟기 감점
  head: 0.05,   // 깃발 반대쪽(73° 넘게) 보기 감점
  face: 0.0,    // 깃발 바라보기 점수 (cos 오차 × 이 값, 기본 꺼짐)
  stop: 0.01,   // 멈춤 명령 감점
  crash: 5.0,   // 부딪힘 감점 (판 끝)
  out: 5.0,     // 길 벗어남 감점 (판 끝)
  win: 3.0,     // 도착 점수 (판 끝)
  tout: 0.0,    // 시간 초과 감점 (판 끝, 기본 0)
  tMax: 30.0,   // 한 판 제한 시간 (초)
};
// PPO 기본값 (화면 기본 = 세상 32 · 학습률 0.002 · 고치기 3)
export const PPO_DEFAULT = { horizon: 64, epochs: 3, mb: 1024, gamma: 0.99, lam: 0.95, clip: 0.2, entStart: 0.02, entEnd: 0.003, entIters: 250, hidden: 64 };

// 물건: [반 길이 hx, 반 폭 hy, 원?, 푹신?] — tori_clutter.OBJECTS 와 같은 크기
export const SHAPES = {
  block: [0.02, 0.02, 0, 0], duplo: [0.032, 0.016, 0, 0], ball: [0.035, 0.035, 1, 0],
  sock: [0.09, 0.045, 0, 1], towel: [0.15, 0.10, 0, 1], cup: [0.037, 0.037, 1, 0],
  bottle: [0.035, 0.035, 1, 0], remote: [0.09, 0.025, 0, 0], toyblocks: [0.08, 0.06, 0, 0],
};
export const SNAMES = Object.keys(SHAPES);
export const SHAPE_KO = { block: "나무 블록", duplo: "레고 블록", ball: "공", sock: "양말", towel: "손수건", cup: "컵", bottle: "물병", remote: "리모컨", toyblocks: "블록 무더기" };

// ---------- 난수 (씨앗 고정) ----------
export class RNG {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; this._g = null; }
  next() { // mulberry32
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  choice(arr) { return arr[this.int(arr.length)]; }
  normal(mu = 0, sd = 1) {
    if (this._g !== null) { const g = this._g; this._g = null; return mu + sd * g; }
    let u = 0, v = 0; while (u === 0) u = this.next(); v = this.next();
    const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
    this._g = r * Math.sin(th); return mu + sd * r * Math.cos(th);
  }
}

// 점에서 물건 테두리까지 거리
function shapeDist(px, py, o, k) {
  const ox = o[k], oy = o[k + 1], oc = o[k + 2], os = o[k + 3], hx = o[k + 4], hy = o[k + 5], circ = o[k + 6];
  const dx = px - ox, dy = py - oy;
  if (circ > 0) return Math.hypot(dx, dy) - hx;
  const lx = oc * dx + os * dy, ly = -os * dx + oc * dy;
  return Math.hypot(Math.max(Math.abs(lx) - hx, 0), Math.max(Math.abs(ly) - hy, 0));
}

// 무작위 코스 (tori_nav2d.random_scene 과 같은 규칙): 길 위 0~4 개 + 길 옆 0~4 개
export function randomScene(r, G) {
  const objs = [];
  const nPath = r.choice([0, 1, 1, 2, 2, 3, 3, 4]);
  const xs = []; for (let i = 0; i < nPath; i++) xs.push(r.uniform(0.45, G - 0.15)); xs.sort((a, b) => a - b);
  for (let k = 0; k < xs.length; k++) {
    if (k > 0) xs[k] = Math.max(xs[k], xs[k - 1] + 0.25);
    objs.push({ name: r.choice(SNAMES.slice(0, 8)), x: xs[k], y: r.normal(0, 0.05), yaw: r.uniform(0, Math.PI) });
  }
  const nSide = r.int(5);
  for (let i = 0; i < nSide; i++) {
    objs.push({ name: r.choice(SNAMES), x: r.uniform(0.3, G + 0.3), y: (r.next() < 0.5 ? -1 : 1) * r.uniform(0.15, 0.7), yaw: r.uniform(0, Math.PI) });
  }
  return objs;
}

// ---------- 연습장 (N 판 한꺼번에) ----------
// 좌표 = 출발점 원점, 목표 방향 +x, 목표점 (G, 0). 길 폭 |y| < 0.7, 성공 = x ≥ G 이고 |y| < 0.3.
export class NavEnv {
  constructor(n, seed = 0, opts = {}) {
    this.n = n; this.r = new RNG(seed * 7919 + 13);
    this.gMin = opts.gMin ?? 1.6; this.gMax = opts.gMax ?? 2.6;
    this.noise = opts.noise ?? true;           // 몸 반응 흔들림 (scale · bias · 출발 방향)
    this.w = { ...REW_DEFAULT, ...(opts.w || {}) };   // 점수 규칙
    this.course = null; this.courseFrac = 0;   // 사용자 코스 {G, objs} 와 그 코스를 쓸 판 비율
    this.st = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.G = new Float32Array(n); this.t = new Float32Array(n); this.last = new Int32Array(n);
    this.scale = new Float32Array(n * 3); this.bias = new Float32Array(n);
    this.obj = new Float32Array(n * M_MAX * 8); this.on = new Uint8Array(n * M_MAX);
    this.onCourse = new Uint8Array(n);
    this.d0 = new Float32Array(n);
    for (let i = 0; i < n; i++) this.reset(i);
  }
  setCourse(course, frac) { this.course = course; this.courseFrac = frac; }

  reset(i, scene = null) {
    const r = this.r;
    this.st[i * 3] = 0; this.st[i * 3 + 1] = 0;
    this.st[i * 3 + 2] = this.noise ? r.uniform(-6, 6) * Math.PI / 180 : 0;
    this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
    this.t[i] = 0; this.last[i] = 0;
    for (let k = 0; k < 3; k++) this.scale[i * 3 + k] = this.noise ? r.uniform(0.85, 1.15) : 1;
    this.bias[i] = this.noise ? r.normal(0, 0.05) : 0;
    let objs, G;
    if (scene) { G = scene.G; objs = scene.objs; this.onCourse[i] = 1; }
    else if (this.course && r.next() < this.courseFrac) { G = this.course.G; objs = this.course.objs; this.onCourse[i] = 1; }
    else { G = r.uniform(this.gMin, this.gMax); objs = randomScene(r, G); this.onCourse[i] = 0; }
    this.G[i] = G;
    for (let j = 0; j < M_MAX; j++) this.on[i * M_MAX + j] = 0;
    for (let j = 0; j < Math.min(objs.length, M_MAX); j++) {
      const o = objs[j], s = SHAPES[o.name], k = (i * M_MAX + j) * 8;
      this.obj[k] = o.x; this.obj[k + 1] = o.y; this.obj[k + 2] = Math.cos(o.yaw); this.obj[k + 3] = Math.sin(o.yaw);
      this.obj[k + 4] = s[0]; this.obj[k + 5] = s[1]; this.obj[k + 6] = s[2]; this.obj[k + 7] = s[3];
      this.on[i * M_MAX + j] = 1;
    }
  }

  dist(i, j) {
    if (!this.on[i * M_MAX + j]) return 9.0;
    return shapeDist(this.st[i * 3], this.st[i * 3 + 1], this.obj, (i * M_MAX + j) * 8);
  }

  // ToF = 몸 앞쪽 (중심선 ± 4 cm 띠), 5~60 cm 안 첫 물건까지 거리 (없으면 0.6)
  tof(i) {
    const x = this.st[i * 3], y = this.st[i * 3 + 1], yaw = this.st[i * 3 + 2];
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let best = 0.6;
    for (let j = 0; j < M_MAX; j++) {
      if (!this.on[i * M_MAX + j]) continue;
      const k = (i * M_MAX + j) * 8, o = this.obj;
      const dx = o[k] - x, dy = o[k + 1] - y;
      const fx = c * dx + s * dy, fy = -s * dx + c * dy;
      const rad = Math.max(o[k + 4], o[k + 5]);
      if (Math.abs(fy) < 0.04 + rad && fx - rad > 0.05 && fx - rad < 0.6) best = Math.min(best, fx - rad);
    }
    return best;
  }

  // 관찰 48 칸을 out[off..] 에 씀. near 배열이 주어지면 가까운 물건 번호 (화면 표시용) 도 돌려줌
  obsInto(i, out, off = 0, near = null) {
    const x = this.st[i * 3], y = this.st[i * 3 + 1], yaw = this.st[i * 3 + 2];
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const gx = this.G[i] - x, gy = -y;
    let p = off;
    out[p++] = (c * gx + s * gy) / 2; out[p++] = (-s * gx + c * gy) / 2;
    out[p++] = c; out[p++] = s;
    out[p++] = this.vel[i * 3] / 0.2; out[p++] = this.vel[i * 3 + 1] / 0.1; out[p++] = this.vel[i * 3 + 2] / 0.9;
    for (let a = 0; a < NA; a++) out[p++] = a === this.last[i] ? 1 : 0;
    // 가까운 물건 K 개 (거리 순, 같으면 번호 순 — numpy argsort 와 같은 결과)
    const ds = new Array(M_MAX);
    for (let j = 0; j < M_MAX; j++) ds[j] = [this.dist(i, j), j];
    ds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let q = 0; q < K_OBJ; q++) {
      const [dd, j] = ds[q];
      const on = this.on[i * M_MAX + j] && dd < 1.2;
      if (near) near[q] = on ? j : -1;
      if (!on) { for (let z = 0; z < 6; z++) out[p++] = 0; continue; }
      const k = (i * M_MAX + j) * 8, o = this.obj;
      const dx = o[k] - x, dy = o[k + 1] - y;
      out[p++] = c * dx + s * dy; out[p++] = -s * dx + c * dy;
      out[p++] = Math.min(dd, 1.2); out[p++] = Math.max(o[k + 4], o[k + 5]) * 5; out[p++] = o[k + 7]; out[p++] = 1;
    }
    out[p++] = this.tof(i) / 0.6;
    return out;
  }

  // 한 걸음 (0.2 초 = 0.05 초 × 4)
  stepOne(i, a) {
    const R = REAL[a];
    const tx = R[0] * this.scale[i * 3], ty = R[1] * this.scale[i * 3 + 1];
    let tz = R[2] * this.scale[i * 3 + 2];
    if (Math.abs(R[0]) > 0) tz += this.bias[i];
    for (let k = 0; k < Math.round(DT_DEC / DT_SIM); k++) this.substep(i, tx, ty, tz);
    this.t[i] += DT_DEC; this.last[i] = a;
  }
  substep(i, tx, ty, tz, dt = DT_SIM) {
    const v = this.vel, st = this.st, b = i * 3;
    v[b] += (tx - v[b]) * (dt / TAU); v[b + 1] += (ty - v[b + 1]) * (dt / TAU); v[b + 2] += (tz - v[b + 2]) * (dt / TAU);
    const c = Math.cos(st[b + 2]), s = Math.sin(st[b + 2]);
    st[b] += (c * v[b] - s * v[b + 1]) * dt;
    st[b + 1] += (s * v[b] + c * v[b + 1]) * dt;
    st[b + 2] += v[b + 2] * dt;
  }

  // 한 걸음 + 보상 (tori_nav2d.Trainer.step_rew 와 같음). 돌려줌: {r, done, kind} kind = win|crash|out|tout|''
  stepRew(i, a) {
    const x0 = this.st[i * 3], y0 = this.st[i * 3 + 1];
    const d0 = Math.hypot(this.G[i] - x0, y0);
    this.stepOne(i, a);
    let dh = 9, ds = 9;
    for (let j = 0; j < M_MAX; j++) {
      if (!this.on[i * M_MAX + j]) continue;
      const d = this.dist(i, j);
      if (this.obj[(i * M_MAX + j) * 8 + 7] === 0) dh = Math.min(dh, d); else ds = Math.min(ds, d);
    }
    const x = this.st[i * 3], y = this.st[i * 3 + 1], yaw = this.st[i * 3 + 2];
    const w = this.w;
    let r = w.prog * (d0 - Math.hypot(this.G[i] - x, y)) - w.time;
    r -= w.lane * clip((Math.abs(y) - 0.15) / 0.1, 0, 3);
    r -= w.near * clip((R_WARN - dh) / (R_WARN - R_BODY), 0, 1);
    r -= w.soft * (ds < R_BODY ? 1 : 0);
    r -= w.head * (Math.cos(yaw) < 0.3 ? 1 : 0);
    if (w.face) r += w.face * Math.cos(Math.atan2(-y, this.G[i] - x) - yaw);
    r -= w.stop * (a === 9 ? 1 : 0);
    const crash = dh < R_BODY, out = Math.abs(y) > LANE_HALF;
    const win = x >= this.G[i] && Math.abs(y) < GOAL_HALF, tout = this.t[i] >= w.tMax;
    r += -w.crash * (crash ? 1 : 0) - w.out * (out ? 1 : 0) + w.win * (win ? 1 : 0);
    if (tout && !crash && !out && !win) r -= w.tout;
    const done = crash || out || win || tout;
    const kind = !done ? "" : crash ? "crash" : win ? "win" : out ? "out" : "tout";
    return { r, done, kind, soft: ds < R_BODY, dh };
  }
}
const clip = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 신경망 (tanh MLP) ----------
export class MLP {
  // sizes = [in, h1, h2, out]
  constructor(sizes, rng = null, outGain = 0.01) {
    this.sizes = sizes; this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const I = sizes[l], O = sizes[l + 1];
      const W = new Float32Array(O * I), b = new Float32Array(O);
      if (rng) { // 직교 초기화 대신 크기 맞춘 정규분포 (마지막 층은 작게)
        const g = l === sizes.length - 2 ? outGain : Math.sqrt(2) ;
        const sd = g / Math.sqrt(I);
        for (let k = 0; k < W.length; k++) W[k] = rng.normal(0, sd);
      }
      this.W.push(W); this.b.push(b);
    }
  }
  static fromJSON(layers) {
    const sizes = [layers[0].W[0].length, ...layers.map(L => L.W.length)];
    const m = new MLP(sizes);
    layers.forEach((L, l) => { m.W[l].set(L.W.flat()); m.b[l].set(L.b); });
    return m;
  }
  toJSON(dig = 5) {
    const f = v => +v.toFixed(dig);
    return this.W.map((W, l) => {
      const I = this.sizes[l], O = this.sizes[l + 1], rows = [];
      for (let o = 0; o < O; o++) rows.push(Array.from(W.subarray(o * I, (o + 1) * I), f));
      return { W: rows, b: Array.from(this.b[l], f) };
    });
  }
  params() { const p = []; for (let l = 0; l < this.W.length; l++) p.push(this.W[l], this.b[l]); return p; }
  copyFrom(m) { m.params().forEach((src, k) => this.params()[k].set(src)); }

  // 묶음 앞 계산. X = Float32Array(B*in). 층별 출력 저장 (뒤 계산용)
  forward(X, B, keep = false) {
    let A = X; const acts = keep ? [X] : null;
    const L = this.W.length;
    for (let l = 0; l < L; l++) {
      const I = this.sizes[l], O = this.sizes[l + 1], W = this.W[l], bb = this.b[l];
      const Y = new Float32Array(B * O);
      for (let n = 0; n < B; n++) {
        const xo = n * I, yo = n * O;
        for (let o = 0; o < O; o++) {
          let s = bb[o]; const wo = o * I;
          for (let i = 0; i < I; i++) s += W[wo + i] * A[xo + i];
          Y[yo + o] = l < L - 1 ? Math.tanh(s) : s;
        }
      }
      A = Y; if (keep) acts.push(Y);
    }
    return keep ? acts : A;
  }
  // 하나만 (화면 시연용)
  forward1(x) { return this.forward(x, 1); }

  // 뒤 계산: acts = forward(keep) 결과, dOut = 손실의 마지막 출력 기울기 (B*out). grads 에 더함
  backward(acts, dOut, B, grads) {
    let D = dOut; const L = this.W.length;
    for (let l = L - 1; l >= 0; l--) {
      const I = this.sizes[l], O = this.sizes[l + 1], W = this.W[l], A = acts[l];
      const gW = grads[2 * l], gb = grads[2 * l + 1];
      const Dprev = l > 0 ? new Float32Array(B * I) : null;
      for (let n = 0; n < B; n++) {
        const ao = n * I, dO = n * O;
        for (let o = 0; o < O; o++) {
          const d = D[dO + o]; if (d === 0) continue;
          gb[o] += d; const wo = o * I;
          for (let i = 0; i < I; i++) { gW[wo + i] += d * A[ao + i]; if (Dprev) Dprev[ao + i] += d * W[wo + i]; }
        }
      }
      if (l > 0) { // tanh 미분: 1 - a²
        for (let k = 0; k < Dprev.length; k++) { const a = A[k]; Dprev[k] *= 1 - a * a; }
        D = Dprev;
      }
    }
  }
  zeroGrads() { return this.params().map(p => new Float32Array(p.length)); }
}

export function softmax(z, off, n, out) {
  let m = -Infinity; for (let k = 0; k < n; k++) m = Math.max(m, z[off + k]);
  let s = 0; for (let k = 0; k < n; k++) { out[k] = Math.exp(z[off + k] - m); s += out[k]; }
  for (let k = 0; k < n; k++) out[k] /= s;
  return out;
}
export function sampleCat(p, r) { let u = r.next(), c = 0; for (let k = 0; k < p.length; k++) { c += p[k]; if (u < c) return k; } return p.length - 1; }
export function argmax(p) { let b = 0; for (let k = 1; k < p.length; k++) if (p[k] > p[b]) b = k; return b; }

// ---------- Adam ----------
class Adam {
  constructor(params, lr) { this.p = params; this.lr = lr; this.t = 0; this.m = params.map(x => new Float32Array(x.length)); this.v = params.map(x => new Float32Array(x.length)); }
  step(grads) {
    this.t++; const b1 = 0.9, b2 = 0.999, eps = 1e-8, lr = this.lr;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (let k = 0; k < this.p.length; k++) {
      const P = this.p[k], G = grads[k], M = this.m[k], V = this.v[k];
      for (let i = 0; i < P.length; i++) {
        const g = G[i]; M[i] = b1 * M[i] + (1 - b1) * g; V[i] = b2 * V[i] + (1 - b2) * g * g;
        P[i] -= lr * (M[i] / c1) / (Math.sqrt(V[i] / c2) + eps);
      }
    }
  }
}

// ---------- PPO 학습기 ----------
export class PPO {
  constructor(o = {}) {
    this.nEnv = o.nEnv ?? 64; this.horizon = o.horizon ?? 64; this.hidden = o.hidden ?? 64;
    this.lr = o.lr ?? 1e-3; this.epochs = o.epochs ?? 4; this.mb = o.mb ?? 1024;
    this.entStart = o.entStart ?? 0.02; this.entEnd = o.entEnd ?? 0.003; this.entIters = o.entIters ?? 250;
    this.gamma = o.gamma ?? 0.99; this.lam = o.lam ?? 0.95; this.clip = o.clip ?? 0.2;
    this.rng = new RNG(o.seed ?? 1);
    this.env = new NavEnv(this.nEnv, o.seed ?? 1, { gMin: o.gMin ?? 1.4, gMax: o.gMax ?? 3.0, w: o.w });
    if (o.brain) { this.pi = MLP.fromJSON(o.brain.pi); this.v = MLP.fromJSON(o.brain.v); this.hidden = this.pi.sizes[1]; this.it = o.brain.iters ?? 0; }
    else { const h = this.hidden; this.pi = new MLP([OBS_DIM, h, h, NA], this.rng, 0.01); this.v = new MLP([OBS_DIM, h, h, 1], this.rng, 1.0); this.it = 0; }
    this.params = [...this.pi.params(), ...this.v.params()];
    this.opt = new Adam(this.params, this.lr);
    this.obs = new Float32Array(this.nEnv * OBS_DIM);
    for (let i = 0; i < this.nEnv; i++) this.env.obsInto(i, this.obs, i * OBS_DIM);
    this.steps = 0; this.watch = o.watch ?? 6;   // 화면에 보여 줄 학습 세상 수
  }
  setLR(lr) { this.lr = lr; this.opt.lr = lr; }
  // 학습 중에 조건 바꾸기 (세상 수 · 두뇌 크기는 새로 만들어야 함)
  setCfg(c = {}) {
    for (const k of ["horizon", "epochs", "mb", "gamma", "lam", "clip", "entStart", "entEnd", "entIters"]) if (c[k] != null) this[k] = c[k];
    if (c.lr != null) this.setLR(c.lr);
    if (c.w) Object.assign(this.env.w, c.w);
  }
  cfgJSON() {
    const o = { lr: this.lr, nEnv: this.nEnv, hidden: this.hidden };
    for (const k of ["horizon", "epochs", "mb", "gamma", "lam", "clip", "entStart", "entEnd", "entIters"]) o[k] = this[k];
    return { ...o, w: { ...this.env.w } };
  }

  // 한 번 반복 = 모으기 (nEnv × horizon) + 고치기. 돌려줌 = 통계 + 지켜볼 세상 기록
  iterate() {
    const N = this.nEnv, T = this.horizon, D = OBS_DIM, env = this.env, t0 = Date.now();
    const O = new Float32Array(T * N * D), A = new Int32Array(T * N), LP = new Float32Array(T * N);
    const R = new Float32Array(T * N), DN = new Float32Array(T * N), V = new Float32Array(T * N);
    const st = { win: 0, crash: 0, out: 0, tout: 0, eps: 0, soft: 0, ret: 0, courseWin: 0, courseEps: 0 };
    const p = new Float32Array(NA);
    const watch = [];
    for (let w = 0; w < this.watch; w++) watch.push({ G: env.G[w], objs: this.objsOf(w), path: [[env.st[w * 3], env.st[w * 3 + 1], env.st[w * 3 + 2]]], ends: [] });
    for (let t = 0; t < T; t++) {
      const lg = this.pi.forward(this.obs, N), vv = this.v.forward(this.obs, N);
      O.set(this.obs, t * N * D);
      for (let i = 0; i < N; i++) {
        softmax(lg, i * NA, NA, p);
        const a = sampleCat(p, this.rng);
        const k = t * N + i;
        A[k] = a; LP[k] = Math.log(p[a] + 1e-12); V[k] = vv[i];
        const res = env.stepRew(i, a);
        R[k] = res.r; DN[k] = res.done ? 1 : 0; st.ret += res.r; if (res.soft) st.soft++;
        if (i < this.watch) watch[i].path.push([env.st[i * 3], env.st[i * 3 + 1], env.st[i * 3 + 2]]);
        if (res.done) {
          st.eps++; st[res.kind]++;
          if (env.onCourse[i]) { st.courseEps++; if (res.kind === "win") st.courseWin++; }
          if (i < this.watch) { watch[i].ends.push({ step: watch[i].path.length - 1, kind: res.kind }); }
          env.reset(i);
          if (i < this.watch) watch[i].ends[watch[i].ends.length - 1].next = { G: env.G[i], objs: this.objsOf(i) };
        }
        env.obsInto(i, this.obs, i * D);
      }
    }
    const vLast = this.v.forward(this.obs, N);
    // GAE
    const ADV = new Float32Array(T * N), RET = new Float32Array(T * N);
    for (let i = 0; i < N; i++) {
      let g = 0;
      for (let t = T - 1; t >= 0; t--) {
        const k = t * N + i, nv = t === T - 1 ? vLast[i] : V[(t + 1) * N + i];
        const nd = 1 - DN[k];
        const delta = R[k] + this.gamma * nv * nd - V[k];
        g = delta + this.gamma * this.lam * nd * g;
        ADV[k] = g; RET[k] = g + V[k];
      }
    }
    let mu = 0; for (const a of ADV) mu += a; mu /= ADV.length;
    let sd = 0; for (const a of ADV) sd += (a - mu) ** 2; sd = Math.sqrt(sd / (ADV.length - 1)) + 1e-8;
    for (let k = 0; k < ADV.length; k++) ADV[k] = (ADV[k] - mu) / sd;
    const entC = Math.max(this.entEnd, this.entStart * (1 - this.it / this.entIters));
    // 고치기
    const total = T * N, idx = new Int32Array(total); for (let k = 0; k < total; k++) idx[k] = k;
    let entSum = 0, entN = 0, clipFrac = 0, vLoss = 0;
    for (let ep = 0; ep < this.epochs; ep++) {
      for (let k = total - 1; k > 0; k--) { const j = this.rng.int(k + 1); const tmp = idx[k]; idx[k] = idx[j]; idx[j] = tmp; }
      for (let s = 0; s < total; s += this.mb) {
        const B = Math.min(this.mb, total - s);
        const X = new Float32Array(B * D);
        for (let n = 0; n < B; n++) X.set(O.subarray(idx[s + n] * D, idx[s + n] * D + D), n * D);
        const actP = this.pi.forward(X, B, true), actV = this.v.forward(X, B, true);
        const lg = actP[actP.length - 1], vo = actV[actV.length - 1];
        const dP = new Float32Array(B * NA), dV = new Float32Array(B);
        for (let n = 0; n < B; n++) {
          const k = idx[s + n], a = A[k], adv = ADV[k];
          softmax(lg, n * NA, NA, p);
          const lp = Math.log(p[a] + 1e-12), ratio = Math.exp(lp - LP[k]);
          let H = 0; for (let j = 0; j < NA; j++) H -= p[j] * Math.log(p[j] + 1e-12);
          entSum += H; entN++;
          const unc = ratio * adv, clp = clip(ratio, 1 - this.clip, 1 + this.clip) * adv;
          const gLp = unc <= clp ? -adv * ratio / B : 0;     // d(-min)/d(lp)
          if (unc > clp) clipFrac++;
          for (let j = 0; j < NA; j++) {
            const onehot = j === a ? 1 : 0;
            dP[n * NA + j] = gLp * (onehot - p[j]) + entC * p[j] * (Math.log(p[j] + 1e-12) + H) / B;
          }
          const e = vo[n] - RET[k]; dV[n] = e / B; vLoss += e * e;   // 0.5 × 2 × e / B
        }
        const gP = this.pi.zeroGrads(), gV = this.v.zeroGrads();
        this.pi.backward(actP, dP, B, gP); this.v.backward(actV, dV, B, gV);
        const grads = [...gP, ...gV];
        let nrm = 0; for (const g of grads) for (let q = 0; q < g.length; q++) nrm += g[q] * g[q];
        nrm = Math.sqrt(nrm);
        if (nrm > 1.0) { const f = 1.0 / (nrm + 1e-6); for (const g of grads) for (let q = 0; q < g.length; q++) g[q] *= f; }
        this.opt.step(grads);
      }
    }
    this.it++; this.steps += total;
    const e = Math.max(st.eps, 1);
    return {
      it: this.it, steps: this.steps, ms: Date.now() - t0, eps: st.eps,
      win: st.win / e, crash: st.crash / e, out: st.out / e, tout: st.tout / e,
      courseWin: st.courseEps ? st.courseWin / st.courseEps : null, courseEps: st.courseEps,
      ret: st.ret / N, ent: entSum / Math.max(entN, 1), entC, clipFrac: clipFrac / Math.max(entN, 1), vLoss: vLoss / Math.max(entN, 1),
      watch,
    };
  }
  objsOf(i) {
    const out = [], env = this.env;
    for (let j = 0; j < M_MAX; j++) {
      if (!env.on[i * M_MAX + j]) continue;
      const k = (i * M_MAX + j) * 8;
      const f = Math.fround, name = SNAMES.find(nm => f(SHAPES[nm][0]) === env.obj[k + 4] && f(SHAPES[nm][1]) === env.obj[k + 5] && SHAPES[nm][2] === env.obj[k + 6] && SHAPES[nm][3] === env.obj[k + 7]) || "block";
      out.push({ name, x: env.obj[k], y: env.obj[k + 1], yaw: Math.atan2(env.obj[k + 3], env.obj[k + 2]) });
    }
    return out;
  }
  brainJSON(name = "새 두뇌") {
    return { kind: "tori-nav-brain", version: 1, name, obs: OBS_DIM, hidden: this.hidden, na: NA, iters: this.it, steps: this.steps, cfg: this.cfgJSON(), pi: this.pi.toJSON(), v: this.v.toJSON() };
  }
}

// ---------- 시험 (정해진 코스를 n 판, 가장 높은 명령) ----------
export function evaluate(pi, scene, n = 20, seed = 1000) {
  const env = new NavEnv(n, seed, { noise: true });
  for (let i = 0; i < n; i++) env.reset(i, scene ? (typeof scene === "function" ? scene(env.r) : scene) : null);
  const obs = new Float32Array(OBS_DIM), p = new Float32Array(NA);
  const res = { win: 0, crash: 0, out: 0, tout: 0, soft: 0, time: 0, kinds: [] };
  for (let i = 0; i < n; i++) {
    let softHit = false;
    for (;;) {
      env.obsInto(i, obs);
      const a = argmax(softmax(pi.forward1(obs), 0, NA, p));
      const r = env.stepRew(i, a);
      if (r.soft) softHit = true;
      if (r.done) { res[r.kind]++; res.kinds.push(r.kind); if (r.kind === "win") res.time += env.t[i]; break; }
    }
    if (softHit) res.soft++;
  }
  res.time = res.win ? res.time / res.win : null;
  return res;
}

// 방 좌표 (출발점 S, 깃발 F, 물건들) → 연습장 좌표 (출발 원점, 깃발 +x)
export function roomToLane(S, F, items) {
  const dx = F.x - S.x, dy = F.y - S.y, G = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  const c = Math.cos(th), s = Math.sin(th);
  const objs = items.map(o => {
    const rx = o.x - S.x, ry = o.y - S.y;
    return { name: o.name, x: c * rx + s * ry, y: -s * rx + c * ry, yaw: o.yaw - th };
  });
  return { G, th, objs };
}
export function laneToRoom(S, th, x, y, yaw) {
  const c = Math.cos(th), s = Math.sin(th);
  return { x: S.x + c * x - s * y, y: S.y + s * x + c * y, yaw: yaw + th };
}

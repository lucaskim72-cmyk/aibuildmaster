// The 30-second shot list: drone pursuit (0-13 s) -> dive into the cockpit (13-16 s) -> first-person run (16-26.2 s)
// -> white-out and logo (26.2-30 s). shot(t, S) returns where the camera is, where it looks, its FOV and roll.
import { THREE } from 'connect-xr';
import { smooth } from './sim.js';
import { EYE } from './cars.js';

export const T = { droneEnd: 13, zoomEnd: 16, whiteStart: 26.2, end: 30 };

// drone keys: camera offset and look point relative to an anchor that follows the hero sideways
const KEYS = [
  { t: 0.0, p: [13, 30, 50], l: [0, 0.0, 3], fov: 34 },
  { t: 3.0, p: [-11, 15, 39], l: [0, 0.5, 5], fov: 37 },
  { t: 6.0, p: [10, 8.5, 32], l: [0, 0.6, 5], fov: 41 },
  { t: 9.0, p: [-7.5, 10.5, 28], l: [0, 0.6, 3], fov: 43 },
  { t: 11.5, p: [2.8, 6.4, 17], l: [0, 0.7, -3], fov: 47 },
  { t: 13.0, p: [0, 3.1, 7.6], l: [0, 0.9, -10], fov: 50 },
];
const cr = (p0, p1, p2, p3, u) => { const u2 = u * u, u3 = u2 * u; return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); };
function droneKey(t) {
  const n = KEYS.length;
  let i = 0; while (i < n - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[Math.max(0, i - 1)], b = KEYS[i], c = KEYS[i + 1], d = KEYS[Math.min(n - 1, i + 2)];
  const u = Math.min(1, Math.max(0, (t - b.t) / (c.t - b.t)));
  const f = (k, j) => cr(a[k][j], b[k][j], c[k][j], d[k][j], u);
  return { p: [f('p', 0), f('p', 1), f('p', 2)], l: [f('l', 0), f('l', 1), f('l', 2)], fov: cr(a.fov, b.fov, c.fov, d.fov, u) };
}
const smoother = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (x * 6 - 15) + 10); };
const bez = (a, b, c, d, u) => { const v = 1 - u; return a * v * v * v + 3 * b * v * v * u + 3 * c * v * u * u + d * u * u * u; };
// fake turbulence for the drone and road vibration for the cockpit (smooth, deterministic)
const wob = (t, f, ph) => Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 2.31 + ph * 1.7) * 0.3 + Math.sin(t * f * 5.13 + ph * 0.3) * 0.1;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export function heroMatrix(S, out = new THREE.Matrix4(), rollK = 1) {
  const h = S.hero;
  _e.set(0, h.yaw, h.roll * rollK, 'YXZ');
  return out.compose(_v.set(h.x, bob(S.t), 0), _q.setFromEuler(_e), new THREE.Vector3(1, 1, 1));
}
export const bob = (t) => 0.012 * Math.sin(t * 17) + 0.006 * Math.sin(t * 31 + 1);

function droneShot(t, S, out) {
  const k = droneKey(t);
  const w = 0.55 + 0.45 * smooth(9.5, 13, t); // how tightly the drone follows the hero sideways
  const ax = S.hero.x * w, turb = 1 - smooth(11.5, 13, t);
  out.pos.set(ax + k.p[0] + wob(t, 1.3, 0) * 0.35 * turb, k.p[1] + wob(t, 1.1, 2) * 0.25 * turb, k.p[2]);
  out.look.set(S.hero.x * (0.8 + 0.2 * w) + k.l[0], k.l[1], k.l[2]);
  out.fov = k.fov;
  // bank into the lateral motion of the drone
  const k2 = droneKey(t + 0.05);
  const vx = (k2.p[0] - k.p[0]) / 0.05;
  out.roll = Math.max(-0.32, Math.min(0.32, -vx * 0.028 + 0.05 * Math.sin(t * 0.8) + wob(t, 0.9, 4) * 0.02)) * (1 - smooth(12, 13, t));
}

const Z0 = [0, 3.1, 7.6], Z1 = [0, 2.35, 4.4], Z2 = [-0.05, 1.5, 2.0];
function zoomShot(t, S, out) {
  const u = (t - T.droneEnd) / (T.zoomEnd - T.droneEnd);
  const e = smoother(Math.pow(u, 1.35));
  const lp = [0, 1, 2].map((j) => bez(Z0[j], Z1[j], Z2[j], EYE.getComponent(j), e));
  // the start is in the drone's (yaw-free) frame, the end in the car's frame: blend so nothing jumps
  const local = new THREE.Vector3(...lp);
  const inCar = local.clone().applyMatrix4(heroMatrix(S, _m, smooth(0.5, 1, u)));
  const inAnchor = local.clone().add(new THREE.Vector3(S.hero.x, 0, 0));
  out.pos.copy(inAnchor).lerp(inCar, smooth(0, 0.5, u));
  const lookStart = new THREE.Vector3(S.hero.x, 0.9, -10);
  const lookEnd = EYE.clone().add(povDir(S).multiplyScalar(30)).applyMatrix4(heroMatrix(S, _m, smooth(0.5, 1, u)));
  out.look.copy(lookStart).lerp(lookEnd, smooth(0.15, 0.85, u));
  out.fov = u < 0.74 ? THREE.MathUtils.lerp(50, 98, smooth(0.05, 0.74, u)) : THREE.MathUtils.lerp(98, povFov(S), smooth(0.74, 1, u));
  out.roll = povRoll(t, S) * smooth(0.55, 1, u);
  out.warp = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 1.6);
}

// look a little into the turn, slight downward pitch, roll with the car plus a bit of g-force lean
const povDir = (S) => new THREE.Vector3(-S.hero.vx * 0.012, 0.035, -1).normalize();
const povRoll = (t, S) => S.hero.roll * 1.35 + S.hero.ax * 0.0025 + wob(t, 23, 3) * 0.003;
const povFov = (S) => 72 + (S.kmh - 320) * 0.16;
function povShot(t, S, out) {
  const M = heroMatrix(S, _m, 1);
  const vk = smooth(16, 16.6, t); // vibration fades in after the dive
  const vib = new THREE.Vector3(wob(t, 41, 0) * 0.0035 * vk, (wob(t, 37, 1) * 0.0045 + wob(t, 7.3, 2) * 0.002) * vk, 0);
  out.pos.copy(EYE).add(vib).applyMatrix4(M);
  out.look.copy(EYE).add(povDir(S).multiplyScalar(30)).applyMatrix4(M);
  out.roll = povRoll(t, S);
  out.fov = povFov(S);
}

export function shot(t, S) {
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, roll: 0, warp: 0, phase: 'drone', white: 0, logo: 0 };
  if (t < T.droneEnd) droneShot(t, S, out);
  else if (t < T.zoomEnd) { out.phase = 'zoom'; zoomShot(t, S, out); }
  else { out.phase = t < T.whiteStart ? 'pov' : 'white'; povShot(t, S, out); }
  if (t >= T.whiteStart) {
    out.white = smooth(T.whiteStart, T.whiteStart + 1.15, t);
    out.logo = smooth(27.35, 28.25, t);
    out.fov += 14 * smooth(T.whiteStart, 27.4, t); // the light "opens up"
  }
  return out;
}

// apply a shot to a camera (roll around the view axis)
export function applyShot(cam, s) {
  cam.position.copy(s.pos);
  cam.up.copy(_up);
  cam.lookAt(s.look);
  cam.rotateZ(s.roll);
  if (Math.abs(cam.fov - s.fov) > 1e-4) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
}

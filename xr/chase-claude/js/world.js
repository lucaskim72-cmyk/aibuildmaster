// The rain-soaked night city: six-lane highway, street lamps, light arches, towers, far skyline, rain and glows.
// Static things live in "period" groups that slide by (s mod period), so the city never ends and costs nothing per frame.
import { THREE, mulberry } from 'connect-xr';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF } from './sim.js';

export const FOG = 0x0a0f1d, FOG_DENSITY = 0.0021;

// ---------- glow points: one draw call for hundreds of soft lights ----------
export function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 900 }, uFog: { value: FOG_DENSITY } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vF;
      uniform float uScale; uniform float uFog;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        float d = max(0.05, -mv.z); gl_PointSize = clamp(size * uScale / d, 0.0, 512.0);
        vF = exp(-pow(d * uFog, 2.0)); vC = color; }`,
    fragmentShader: `varying vec3 vC; varying float vF;
      void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float r = dot(c,c); if (r > 1.0) discard;
        float a = exp(-r * 5.0) * 0.9 + exp(-r * 38.0) * 1.2; gl_FragColor = vec4(vC * a * vF, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
export function glowPoints(n, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  const p = new THREE.Points(g, mat); p.frustumCulled = false;
  let i = 0;
  return {
    points: p,
    begin() { i = 0; },
    add(x, y, z, r, gg, b, size) { if (i >= n) return; const P = g.attributes.position.array, C = g.attributes.color.array; P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; C[i * 3] = r; C[i * 3 + 1] = gg; C[i * 3 + 2] = b; g.attributes.size.array[i] = size; i++; },
    end() { g.setDrawRange(0, i); for (const k of ['position', 'color', 'size']) g.attributes[k].needsUpdate = true; },
  };
}

// soft streak texture for wet-road reflections
function streakTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const gx = x.createLinearGradient(0, 0, 64, 0); gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gx; x.fillRect(0, 0, 64, 256);
  x.globalCompositeOperation = 'destination-in';
  const gy = x.createLinearGradient(0, 0, 0, 256); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.25, 'rgba(0,0,0,0.9)'); gy.addColorStop(0.55, 'rgba(0,0,0,0.45)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gy; x.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const STREAK = { tex: null };
export function streakMaterial() {
  if (!STREAK.tex) STREAK.tex = streakTexture();
  return new THREE.MeshBasicMaterial({ map: STREAK.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: 0xffffff, fog: true });
}
// a flat streak lying on the road, length along z (unit: 1 m wide, 1 m long; scale it)
export const streakGeo = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// environment for reflections: a dark city with warm and cool light panels (no image files)
export function cityEnvironment(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x070a14);
  const add = (color, w, h, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; s.add(m); };
  add(new THREE.Color(0.9, 0.55, 0.22), 6, 2.4, -7, 2.5, -2, Math.PI / 2);
  add(new THREE.Color(0.3, 0.6, 1.0), 4, 5, 7, 3.5, -3, -Math.PI / 2);
  add(new THREE.Color(0.55, 0.35, 0.9), 8, 3, 0, 4, -9);
  add(new THREE.Color(1.2, 0.9, 0.7), 10, 0.5, 0, 7, 0);
  add(new THREE.Color(0.25, 0.3, 0.45), 30, 6, 0, 1, 10);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 8), new THREE.MeshBasicMaterial({ color: 0x141a30, side: THREE.BackSide })); s.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.02).texture; pm.dispose();
  return env;
}

function canvasTex(w, h, draw, { repeat = null, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

export function buildWorld({ scene, renderer, env, glowMat }) {
  const R = mulberry(2026);
  const root = new THREE.Group(); root.name = 'city'; scene.add(root);
  const vrOnly = []; // hidden in AR passthrough
  const ROAD_W = ROAD_HALF * 2 + 4; // lanes + shoulders
  const ROAD_LEN = 1300, ROAD_Z = -480;

  // ---------- road: wet asphalt with lane paint (texture scrolls with distance) ----------
  const DASH = 24;
  const roadMap = canvasTex(1024, 1024, (x, w, h) => {
    x.fillStyle = '#16181d'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 18 + Math.random() * 26; x.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    const m = (xm) => ((xm + ROAD_W / 2) / ROAD_W) * w; // metres across -> px
    x.fillStyle = 'rgba(235,235,225,0.92)';
    for (const e of [-ROAD_HALF, ROAD_HALF]) x.fillRect(m(e) - 4, 0, 8, h);
    for (let l = 1; l < 6; l++) { const xm = -ROAD_HALF + l * 3.6; x.fillRect(m(xm) - 3, 0, 6, h * 0.42); }
    x.fillStyle = 'rgba(214,137,42,0.85)'; x.fillRect(m(-ROAD_HALF) - 16, 0, 5, h); x.fillRect(m(ROAD_HALF) + 11, 0, 5, h);
  }, { repeat: [1, ROAD_LEN / DASH] });
  const roadRough = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const px = Math.random() * w, py = Math.random() * h, r = 20 + Math.random() * 70; const g2 = x.createRadialGradient(px, py, 0, px, py, r); g2.addColorStop(0, 'rgba(10,10,10,0.95)'); g2.addColorStop(1, 'rgba(10,10,10,0)'); x.fillStyle = g2; x.beginPath(); x.ellipse(px, py, r * 0.6, r * 1.6, 0, 0, 7); x.fill(); }
  }, { repeat: [2, ROAD_LEN / 60], srgb: false });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: roadMap, roughnessMap: roadRough, roughness: 0.42, metalness: 0.55, envMap: env, envMapIntensity: 1.25, color: 0xb0b4bd }));
  road.position.z = ROAD_Z; root.add(road);
  // ground beyond the road (dark, wet)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, ROAD_LEN).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.3, metalness: 0.5, envMap: env, envMapIntensity: 0.6 }));
  ground.position.set(0, -0.6, ROAD_Z); root.add(ground);
  // barriers with joints and amber reflectors
  const barrierTex = () => canvasTex(256, 64, (x, w, h) => {
    x.fillStyle = '#3a3d44'; x.fillRect(0, 0, w, h); x.fillStyle = '#2a2c31'; x.fillRect(0, 0, 3, h); x.fillRect(0, h * 0.7, w, 3);
    x.fillStyle = '#ffb347'; x.fillRect(w * 0.5, h * 0.35, 10, 6);
  }, { repeat: [ROAD_LEN / 8, 1] });
  // BoxGeometry maps u along -z on its +x face and along +z on its -x face, so each side scrolls its own way
  const barrierMaps = [barrierTex(), barrierTex()];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.05, ROAD_LEN), new THREE.MeshStandardMaterial({ map: barrierMaps[i], roughness: 0.6, metalness: 0.2, envMap: env, envMapIntensity: 0.5 }));
    b.position.set(sx * (ROAD_W / 2 + 0.25), 0.52, ROAD_Z); root.add(b);
  }
  const textures = { roadMap, roadRough, barrierMaps };

  // ---------- street lamps (period 36 m) ----------
  const LP = 36, lamps = new THREE.Group(); root.add(lamps);
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.16, 11, 8).translate(0, 5.5, 0),
    new THREE.BoxGeometry(0.16, 0.16, 3.2).rotateY(Math.PI / 2).translate(-1.5, 10.9, 0),
    new THREE.BoxGeometry(0.9, 0.18, 0.4).translate(-3.0, 10.8, 0),
  ]);
  const lampsN = 40 * 2;
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x202329, metalness: 0.8, roughness: 0.4, envMap: env }), lampsN);
  const lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.78, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.8), toneMapped: false }), lampsN);
  const lampRefl = new THREE.InstancedMesh(streakGeo(), streakMaterial(), lampsN);
  lampRefl.material.color = new THREE.Color(1.0, 0.62, 0.3);
  const lampGlow = glowPoints(lampsN, glowMat);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
  const lampX = ROAD_W / 2 + 0.9;
  lampGlow.begin();
  let li = 0;
  for (let k = -34; k < 6; k++) for (const sx of [-1, 1]) {
    const z = k * LP + (sx > 0 ? LP / 2 : 0);
    Q.setFromAxisAngle(V.set(0, 1, 0), sx > 0 ? 0 : Math.PI);
    M.compose(V.set(sx * lampX, 0, z), Q, S.set(1, 1, 1)); poles.setMatrixAt(li, M);
    const hx = sx * (lampX - 3.0);
    M.compose(V.set(hx, 10.69, z), Q, S.set(1, 1, 1)); lampHeads.setMatrixAt(li, M);
    M.compose(V.set(hx * 0.92, 0.02, z + 7), new THREE.Quaternion(), S.set(1.3, 1, 15)); lampRefl.setMatrixAt(li, M);
    lampGlow.add(hx, 10.6, z, 1.0, 0.66, 0.34, 2.6);
    li++;
  }
  lampGlow.end();
  lamps.add(poles, lampHeads, lampRefl, lampGlow.points);
  for (const m of [poles, lampHeads, lampRefl]) m.frustumCulled = false;

  // ---------- light arches over the road (period 216 m) ----------
  const AP = 216, arches = new THREE.Group(); root.add(arches);
  const archR = ROAD_W / 2 + 1.2;
  const archGeo = mergeGeometries([
    new THREE.TorusGeometry(archR, 0.42, 8, 56, Math.PI),
    new THREE.BoxGeometry(1.2, 1.4, 1.2).translate(archR, 0.2, 0), new THREE.BoxGeometry(1.2, 1.4, 1.2).translate(-archR, 0.2, 0),
  ]);
  const ledGeo = mergeGeometries([new THREE.TorusGeometry(archR - 0.5, 0.07, 6, 72, Math.PI), new THREE.TorusGeometry(archR - 0.5, 0.07, 6, 72, Math.PI).translate(0, 0, 0.9)]);
  const nA = 8;
  const archM = new THREE.InstancedMesh(archGeo, new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.85, roughness: 0.35, envMap: env }), nA);
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3.2), toneMapped: false });
  const ledM = new THREE.InstancedMesh(ledGeo, ledMat, nA);
  const archRefl = new THREE.InstancedMesh(streakGeo(), streakMaterial(), nA * 3);
  archRefl.material.color = new THREE.Color(0.25, 0.9, 1.3);
  const archGlow = glowPoints(nA * 14, glowMat);
  archGlow.begin();
  for (let k = 0; k < nA; k++) {
    const z = (k - 6) * AP + 40;
    M.makeTranslation(0, 0, z); archM.setMatrixAt(k, M); ledM.setMatrixAt(k, M);
    for (let j = 0; j < 3; j++) { M.compose(V.set((j - 1) * 7, 0.03, z + 10), new THREE.Quaternion(), S.set(2.2, 1, 22)); archRefl.setMatrixAt(k * 3 + j, M); }
    for (let j = 0; j <= 12; j++) { const a = (j / 12) * Math.PI; archGlow.add(Math.cos(a) * (archR - 0.5), Math.sin(a) * (archR - 0.5), z + 0.45, 0.25, 0.8, 1.1, 2.2); }
  }
  archGlow.end();
  arches.add(archM, ledM, archRefl, archGlow.points);
  for (const m of [archM, ledM, archRefl]) m.frustumCulled = false;

  // ---------- towers (period 480 m, five copies) ----------
  const BP = 480, towers = new THREE.Group(); root.add(towers);
  const facade = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#0d1118'; x.fillRect(0, 0, w, h);
    const cw = w / 16, ch = h / 16;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { const v = 22 + Math.random() * 18; x.fillStyle = `rgb(${v},${v + 6},${v + 16})`; x.fillRect(i * cw + 2, j * ch + 3, cw - 4, ch - 6); }
    x.fillStyle = '#05070a'; x.fillRect(0, 0, cw, ch); // corner cell = roof colour
  });
  const lit = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    const cw = w / 16, ch = h / 16; let a = 7; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let j = 0; j < 16; j++) {
      const floorLit = r() < 0.18;
      for (let i = 0; i < 16; i++) {
        if (i === 0 && j === 0) continue;
        if (!(floorLit ? r() < 0.85 : r() < 0.26)) continue;
        const warm = r() < 0.62, k = 0.55 + r() * 0.45;
        x.fillStyle = warm ? `rgba(255,${190 + r() * 40 | 0},${120 + r() * 50 | 0},${k})` : `rgba(${150 + r() * 40 | 0},${200 + r() * 40 | 0},255,${k})`;
        x.fillRect(i * cw + 2, j * ch + 3, cw - 4, ch - 6);
      }
    }
  });
  const towerMat = new THREE.MeshStandardMaterial({ map: facade, emissiveMap: lit, emissive: new THREE.Color(1.6, 1.45, 1.3), roughness: 0.35, metalness: 0.7, envMap: env, envMapIntensity: 0.7 });
  towerMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 bs = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec2 rep = abs(normal.y) > 0.5 ? vec2(0.0) : (abs(normal.x) > 0.5 ? vec2(bs.z, bs.y) : vec2(bs.x, bs.y));
        vec2 off = abs(normal.y) > 0.5 ? vec2(0.0) : floor(fract(instanceMatrix[3].xz * vec2(0.0173, 0.0291) + normal.xz * 0.37) * 16.0) / 16.0;
        vec2 buv = uv * rep / vec2(3.4 * 16.0, 3.8 * 16.0) + off + vec2(0.0001, 0.0001);
        #ifdef USE_MAP
          vMapUv = buv;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = buv;
        #endif
      #endif`);
  };
  const towerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const T = [];
  for (const sx of [-1, 1]) {
    // near row: canyon walls right behind the barrier; far row: taller, set back
    for (const row of [0, 1]) {
      let z = 0;
      while (z > -BP) {
        const d = row ? 30 + R() * 40 : 22 + R() * 26;
        const w = row ? 30 + R() * 40 : 18 + R() * 16;
        const h = row ? 120 + R() * 200 : 45 + R() * 150 * (R() < 0.3 ? 1.6 : 1);
        const x = sx * ((row ? 62 : ROAD_W / 2 + 6) + w / 2 + R() * (row ? 50 : 6));
        T.push({ x, z: z - d / 2, w, d, h, tint: R() });
        z -= d + (row ? 6 + R() * 20 : 3 + R() * 10);
      }
    }
  }
  const copies = [-3, -2, -1, 0, 1];
  const towerM = new THREE.InstancedMesh(towerGeo, towerMat, T.length * copies.length);
  const neonGeo = new THREE.BoxGeometry(0.35, 1, 0.35).translate(0, 0.5, 0);
  const neonM = new THREE.InstancedMesh(neonGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), T.length * copies.length);
  const roofGlow = glowPoints(T.length * copies.length, glowMat);
  const col = new THREE.Color();
  let ti = 0, ni = 0;
  roofGlow.begin();
  for (const c of copies) for (const b of T) {
    const z = b.z + c * BP;
    M.compose(V.set(b.x, 0, z), Q.identity(), S.set(b.w, b.h, b.d)); towerM.setMatrixAt(ti, M);
    towerM.setColorAt(ti++, col.setHSL(0.6 + b.tint * 0.06, 0.12, 0.55 + b.tint * 0.3));
    if (b.tint > 0.45) {
      const ex = b.x - Math.sign(b.x) * (b.w / 2), ez = z + (b.tint > 0.7 ? b.d / 2 : -b.d / 2);
      M.compose(V.set(ex, 0, ez), Q.identity(), S.set(1, b.h * (0.55 + b.tint * 0.45), 1)); neonM.setMatrixAt(ni, M);
      const pal = [[0.2, 1.6, 2.4], [2.6, 1.3, 0.35], [2.2, 0.35, 1.1], [0.35, 0.9, 2.6]][Math.floor(b.tint * 97) % 4];
      neonM.setColorAt(ni++, col.setRGB(...pal));
    }
    roofGlow.add(b.x, b.h + 1.5, z, 2.2, 0.15, 0.1, 3.5);
  }
  roofGlow.end();
  neonM.count = ni;
  towers.add(towerM, neonM, roofGlow.points);
  for (const m of [towerM, neonM]) m.frustumCulled = false;
  vrOnly.push(ground);

  // ---------- far skyline and sky (follow the camera) ----------
  const skyline = canvasTex(2048, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    let px = 0; let a = 3; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    while (px < w) {
      const bw = 14 + r() * 50, bh = 40 + r() * r() * 200;
      x.fillStyle = `rgb(${10 + r() * 8 | 0},${13 + r() * 8 | 0},${24 + r() * 12 | 0})`; x.fillRect(px, h - bh, bw, bh);
      for (let k = 0; k < bh * bw / 60; k++) if (r() < 0.3) { x.fillStyle = r() < 0.6 ? 'rgba(255,200,140,0.8)' : 'rgba(160,210,255,0.7)'; x.fillRect(px + r() * bw, h - r() * bh, 1.5, 1.5); }
      if (r() < 0.2) { x.fillStyle = 'rgba(255,60,50,0.9)'; x.fillRect(px + bw / 2, h - bh - 2, 2, 2); }
      px += bw + r() * 4;
    }
  }, { repeat: [3, 1], aniso: 4 });
  const far = new THREE.Mesh(new THREE.CylinderGeometry(1150, 1150, 330, 48, 1, true), new THREE.MeshBasicMaterial({ map: skyline, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false, color: 0x9aa2b8 }));
  far.position.y = 150; far.renderOrder = -1;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uTime;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){ vec3 d = normalize(vP); float y = max(d.y, 0.0);
        vec3 zen = vec3(0.012,0.016,0.035), hor = vec3(0.11,0.07,0.12), glow = vec3(0.32,0.15,0.1);
        vec3 c = mix(hor, zen, pow(y, 0.45)); c += glow * exp(-y * 9.0) * 0.7;
        vec2 q = d.xz / (d.y + 0.25) * 2.0; float cl = n(q + uTime * 0.02) * 0.6 + n(q * 2.3 - uTime * 0.03) * 0.4;
        c += vec3(0.09,0.07,0.1) * smoothstep(0.45, 0.9, cl) * (1.0 - y) ;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -2;
  scene.add(sky, far);
  vrOnly.push(sky, far);

  // ---------- rain: thousands of streaks in one draw call, moved in the vertex shader ----------
  const RN = 5200, rainGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(RN * 2 * 3), rk = new Float32Array(RN * 2);
  for (let i = 0; i < RN; i++) { const x = (R() - 0.5) * 80, y = R() * 45, z = R() * 120 - 95; for (const k of [0, 1]) { rp.set([x, y, z], (i * 2 + k) * 3); rk[i * 2 + k] = k; } }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rainGeo.setAttribute('tail', new THREE.BufferAttribute(rk, 1));
  const rainMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRel: { value: 26 }, uAlpha: { value: 0.32 } },
    vertexShader: `attribute float tail; uniform float uT; uniform vec3 uCam; uniform float uRel; varying float vA;
      void main(){ vec3 p = position; vec3 vel = vec3(-1.5, -13.0, uRel);
        p.y = mod(p.y + vel.y * uT, 45.0); p.z = mod(p.z + vel.z * uT + 95.0, 120.0) - 95.0; p.x = mod(p.x + vel.x * uT + 40.0, 80.0) - 40.0;
        vec3 w = vec3(uCam.x, max(0.0, uCam.y - 18.0), uCam.z) + p;
        w -= vel * 0.045 * tail;
        vec4 mv = viewMatrix * vec4(w, 1.0); gl_Position = projectionMatrix * mv;
        vA = (1.0 - tail * 0.85) * exp(-pow(-mv.z * 0.018, 2.0)); }`,
    fragmentShader: 'uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.62,0.72,0.9) * vA * uAlpha, 1.0); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; rain.renderOrder = 4;
  scene.add(rain);

  function update(s, t, cam) {
    roadMap.offset.y = (s / DASH) % 1;
    roadRough.offset.y = (s / 60) % 1;
    barrierMaps[1].offset.x = (s / 8) % 1; barrierMaps[0].offset.x = -(s / 8) % 1;
    lamps.position.z = s % LP;
    arches.position.z = s % AP;
    towers.position.z = s % BP;
    ledMat.color.setRGB(0.6 + 0.25 * Math.sin(t * 2.0), 2.2 + 0.4 * Math.sin(t * 2.0), 3.0);
    sky.position.copy(cam.position); far.position.set(cam.position.x, 150 + cam.position.y * 0.2, cam.position.z);
    sky.material.uniforms.uTime.value = t;
    rainMat.uniforms.uT.value = t; rainMat.uniforms.uCam.value.copy(cam.position);
  }
  return { root, update, rain, rainMat, vrOnly, sky, far, road, textures };
}

// 토리 길 찾기 실험실 — 화면 (three.js) · 시연 · 코스 꾸미기 · 학습 워커 연결
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  ACT_NAMES, ACT_ICONS, NA, OBS_DIM, K_OBJ, M_MAX, R_BODY, R_WARN, DT_DEC, T_MAX, LANE_HALF, GOAL_HALF,
  SHAPES, SNAMES, SHAPE_KO, REW_DEFAULT, PPO_DEFAULT, NavEnv, MLP, RNG, softmax, sampleCat, argmax, evaluate, randomScene, roomToLane, laneToRoom,
} from "./nav_core.js";
import { say, sayNow, stopVoice, trainingMusic, bindSoundButtons } from "./sound.js";

const $ = (id) => document.getElementById(id);
const FLOOR = { x0: -0.9, x1: 3.9, y0: -1.55, y1: 1.55 };
const G_MIN = 1.0, G_MAX = 3.2;
const COLORS = {
  block: 0xD9A35B, duplo: 0xE24B3B, ball: 0x3B82F6, sock: 0x7DD3FC, towel: 0xBAE6FD,
  cup: 0xF5F5F4, bottle: 0x60A5FA, remote: 0x27272A, toyblocks: 0xF59E0B,
};

// ---------------- 상태 ----------------
const room = {
  S: { x: 0, y: 0 }, F: { x: 2.3, y: 0.0 },
  items: [
    { name: "duplo", x: 0.75, y: 0.03, yaw: 0.4 },
    { name: "cup", x: 1.15, y: 0.42, yaw: 0 },
    { name: "ball", x: 1.45, y: -0.06, yaw: 0 },
    { name: "sock", x: 1.85, y: 0.18, yaw: 1.1 },
    { name: "remote", x: 1.0, y: -0.45, yaw: 0.3 },
  ],
};
let nextId = 1; room.items.forEach(o => (o.id = nextId++));
const ui = { tool: null, sel: null, speed: 1, mode: "greedy", brain: "teacher", cam: "iso", demoPaused: false };
let teacherJSON = null, teacher = null, student = null, studentIt = 0;

// ---------------- three.js 기본 ----------------
const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0B1120);
scene.fog = new THREE.Fog(0x0B1120, 6, 13);
const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 60);
camera.position.set(-1.2, 2.6, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1.2, 0, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 0.6; controls.maxDistance = 9;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// 2D (x, y) → three (x, h, -y)
const V3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

// 빛: 창가 햇살 (따뜻) + 하늘빛 + 테두리 빛
scene.add(new THREE.HemisphereLight(0xFFF1D6, 0x1E293B, 0.75));
const sun = new THREE.DirectionalLight(0xFFE2B0, 1.9);
sun.position.set(-2.5, 4.5, 2.5); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
sun.target.position.set(1.4, 0, 0); scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0x7DD3FC, 0.45); rim.position.set(4, 2, -3); scene.add(rim);

// 바닥: 나무 마루 (캔버스로 그림)
function woodTexture() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 1024;
  const g = c.getContext("2d"); const r = new RNG(5);
  const plankH = 1024 / 8;
  for (let row = 0; row < 8; row++) {
    let x = -r.uniform(0, 400);
    while (x < 1024) {
      const w = r.uniform(380, 620), base = r.uniform(0, 1);
      const h = 26 + base * 7, s = 30 + base * 10, l = 21 + base * 9;
      g.fillStyle = `hsl(${h},${s}%,${l}%)`; g.fillRect(x, row * plankH, w, plankH);
      for (let k = 0; k < 26; k++) { // 나뭇결
        g.strokeStyle = `hsla(${h - 4},${s}%,${l - 8}%,${r.uniform(0.05, 0.18)})`; g.lineWidth = r.uniform(0.6, 2.2);
        const yy = row * plankH + r.uniform(4, plankH - 4); g.beginPath(); g.moveTo(x, yy);
        g.bezierCurveTo(x + w * 0.3, yy + r.uniform(-6, 6), x + w * 0.7, yy + r.uniform(-6, 6), x + w, yy + r.uniform(-3, 3)); g.stroke();
      }
      g.fillStyle = "rgba(20,12,6,.55)"; g.fillRect(x, row * plankH, 2, plankH);
      x += w;
    }
    g.fillStyle = "rgba(20,12,6,.6)"; g.fillRect(0, row * plankH, 1024, 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; t.repeat.set(2.2, 1.6); return t;
}
const floorW = FLOOR.x1 - FLOOR.x0 + 0.6, floorD = FLOOR.y1 - FLOOR.y0 + 0.6;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.62, metalness: 0.0 }));
floor.rotation.x = -Math.PI / 2; floor.position.set((FLOOR.x0 + FLOOR.x1) / 2, 0, 0); floor.receiveShadow = true;
scene.add(floor);
// 방 밖 어두운 바닥
const outer = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x0B1120, roughness: 1 }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.002; scene.add(outer);
// 벽 두 면 + 걸레받이
const wallMat = new THREE.MeshStandardMaterial({ color: 0xE7DCC8, roughness: 0.95 });
const baseMat = new THREE.MeshStandardMaterial({ color: 0xF8F4EC, roughness: 0.6 });
function wall(len, x, y, rotY) {
  const g = new THREE.Group();
  const w = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.04), wallMat); w.position.y = 0.45; w.receiveShadow = true;
  const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.055), baseMat); b.position.y = 0.035;
  g.add(w, b); g.position.copy(V3(x, y)); g.rotation.y = rotY; scene.add(g); return g;
}
wall(floorW, (FLOOR.x0 + FLOOR.x1) / 2, FLOOR.y1 + 0.32, 0);
wall(floorD, FLOOR.x0 - 0.32, 0, Math.PI / 2);
// 소품: 소파 · 화분 (길 밖, 분위기)
(function decor() {
  const sofa = new THREE.Group(), fab = new THREE.MeshStandardMaterial({ color: 0x5B8C3A, roughness: 0.9 });
  const seat = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.36, 0.7, 4, 0.06), fab); seat.position.y = 0.2;
  const back = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.5, 0.18, 4, 0.06), fab); back.position.set(0, 0.45, -0.28);
  const armL = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.5, 0.7, 4, 0.05), fab); armL.position.set(-0.8, 0.3, 0);
  const armR = armL.clone(); armR.position.x = 0.8;
  sofa.add(seat, back, armL, armR); sofa.traverse(m => { m.castShadow = true; m.receiveShadow = true; });
  sofa.scale.setScalar(0.8); sofa.position.copy(V3(2.9, FLOOR.y1 + 0.02)); scene.add(sofa);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.26, 24), new THREE.MeshStandardMaterial({ color: 0xC2703D, roughness: 0.8 }));
  pot.position.copy(V3(-0.6, FLOOR.y1 - 0.05, 0.13)); pot.castShadow = true; scene.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3F7D3A, roughness: 0.7, side: THREE.DoubleSide });
  for (let k = 0; k < 9; k++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), leafMat);
    leaf.scale.set(0.35, 1.5, 0.12); const a = k / 9 * Math.PI * 2;
    leaf.position.copy(pot.position).add(new THREE.Vector3(Math.cos(a) * 0.06, 0.28 + (k % 3) * 0.04, Math.sin(a) * 0.06));
    leaf.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5); leaf.castShadow = true; scene.add(leaf);
  }
})();

// ---------------- 길 띠 · 깃발 · 출발 패드 ----------------
const laneGroup = new THREE.Group(); scene.add(laneGroup);
const laneMat = new THREE.MeshBasicMaterial({ color: 0xFDE68A, transparent: true, opacity: 0.045, depthWrite: false });
const goalMat = new THREE.MeshBasicMaterial({ color: 0x4ADE80, transparent: true, opacity: 0.16, depthWrite: false });
const edgeMat = new THREE.LineDashedMaterial({ color: 0xFACC15, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.55 });
function rebuildLane() {
  laneGroup.clear();
  const L = roomToLane(room.S, room.F, []);
  const len = L.G + 0.35;
  const band = new THREE.Mesh(new THREE.PlaneGeometry(len, LANE_HALF * 2), laneMat);
  band.rotation.x = -Math.PI / 2; band.position.set(len / 2 - 0.1, 0.002, 0);
  const goal = new THREE.Mesh(new THREE.PlaneGeometry(0.35, GOAL_HALF * 2), goalMat);
  goal.rotation.x = -Math.PI / 2; goal.position.set(L.G + 0.175, 0.003, 0);
  laneGroup.add(band, goal);
  for (const s of [-1, 1]) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.1, 0.004, s * LANE_HALF), new THREE.Vector3(len - 0.1, 0.004, s * LANE_HALF)]);
    const ln = new THREE.Line(geo, edgeMat); ln.computeLineDistances(); laneGroup.add(ln);
  }
  const gl = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(L.G, 0.005, -GOAL_HALF), new THREE.Vector3(L.G, 0.005, GOAL_HALF)]);
  laneGroup.add(new THREE.Line(gl, new THREE.LineBasicMaterial({ color: 0x4ADE80 })));
  laneGroup.position.copy(V3(room.S.x, room.S.y)); laneGroup.rotation.y = L.th;
}

const flag = new THREE.Group();
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xE5E7EB, metalness: 0.6, roughness: 0.3 }));
  pole.position.y = 0.21; pole.castShadow = true;
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.16, -0.05); shape.lineTo(0, -0.1);
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xFACC15, emissive: 0xFACC15, emissiveIntensity: 0.9, side: THREE.DoubleSide }));
  cloth.position.set(0.006, 0.41, 0); cloth.name = "cloth";
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 48), new THREE.MeshBasicMaterial({ color: 0xFACC15, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.006; ring.name = "ring";
  const glow = new THREE.PointLight(0xFACC15, 0.6, 0.9); glow.position.y = 0.3;
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.45, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.22; hit.userData.pick = { kind: "flag" };
  flag.add(pole, cloth, ring, glow, hit);
}
scene.add(flag);
const startPad = new THREE.Group();
{
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16, 48), new THREE.MeshBasicMaterial({ color: 0x7DD3FC, transparent: true, opacity: 0.12 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.003;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.165, 48), new THREE.MeshBasicMaterial({ color: 0x7DD3FC, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004;
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.pick = { kind: "start" };
  startPad.add(disc, ring, hit);
}
scene.add(startPad);

// ---------------- 물건 3D ----------------
const objGroup = new THREE.Group(); scene.add(objGroup);
const objMeshes = new Map();
function std(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o }); }
function makeObject(name) {
  const [hx, hy, circ, soft] = SHAPES[name];
  const g = new THREE.Group(), body = new THREE.Group();
  const add = (m) => { m.castShadow = true; m.receiveShadow = true; body.add(m); return m; };
  const col = COLORS[name];
  switch (name) {
    case "block": { const m = add(new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.04, 0.04, 2, 0.004), std(col, { roughness: 0.75 }))); m.position.y = 0.02; break; }
    case "duplo": {
      const m = add(new THREE.Mesh(new RoundedBoxGeometry(0.064, 0.024, 0.032, 2, 0.003), std(col, { roughness: 0.3 }))); m.position.y = 0.012;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const s = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0048, 0.005, 14), std(col, { roughness: 0.3 }))); s.position.set(-0.024 + i * 0.016, 0.0265, -0.008 + j * 0.016); }
      break;
    }
    case "ball": { const m = add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 32, 20), std(col, { roughness: 0.35 }))); m.position.y = 0.035;
      const band = add(new THREE.Mesh(new THREE.TorusGeometry(0.0352, 0.004, 8, 40), std(0xFACC15))); band.position.y = 0.035; break; }
    case "sock": {
      const m = add(new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.018, 0.07, 4, 0.009), std(col, { roughness: 0.95 }))); m.position.y = 0.009;
      const toe = add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10), std(0x38BDF8, { roughness: 0.95 }))); toe.scale.set(1, 0.28, 1); toe.position.set(0.075, 0.009, 0);
      for (let k = 0; k < 3; k++) { const st = add(new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.0185, 0.071), std(0xFFFFFF, { roughness: 0.95 }))); st.position.set(-0.06 + k * 0.02, 0.0092, 0); }
      break;
    }
    case "towel": {
      const m = add(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.008, 0.2, 2, 0.003), std(col, { roughness: 1 }))); m.position.y = 0.004;
      const st = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.0085, 0.02), std(0x7DD3FC, { roughness: 1 }))); st.position.set(0, 0.0045, 0.07);
      break;
    }
    case "cup": {
      const m = add(new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.03, 0.09, 32, 1, true), std(col, { roughness: 0.25, side: THREE.DoubleSide }))); m.position.y = 0.045;
      const bot = add(new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), std(col))); bot.rotation.x = -Math.PI / 2; bot.position.y = 0.002;
      const h = add(new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 8, 20, Math.PI), std(col, { roughness: 0.25 }))); h.position.set(0.037, 0.045, 0); h.rotation.z = -Math.PI / 2;
      const coffee = add(new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), std(0x5B3A1E))); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.075;
      break;
    }
    case "bottle": {
      const glass = std(col, { roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55 });
      const m = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 28), glass)); m.position.y = 0.08;
      const n = add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.033, 0.04, 20), glass)); n.position.y = 0.18;
      const c = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.018, 16), std(0x1D4ED8))); c.position.y = 0.205;
      break;
    }
    case "remote": {
      const m = add(new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.02, 0.05, 3, 0.008), std(col, { roughness: 0.4 }))); m.position.y = 0.01;
      for (let k = 0; k < 6; k++) { const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.004, 10), std(k === 0 ? 0xEF4444 : 0x9CA3AF))); b.position.set(-0.06 + (k % 3) * 0.03 + (k > 2 ? 0.08 : 0), 0.021, k % 2 ? 0.01 : -0.01); }
      break;
    }
    case "toyblocks": {
      const r = new RNG(11), cs = [0xF59E0B, 0xEF4444, 0x10B981, 0x3B82F6, 0xA855F7];
      for (let k = 0; k < 9; k++) {
        const s = r.uniform(0.028, 0.04);
        const m = add(new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 2, 0.003), std(cs[k % 5], { roughness: 0.6 })));
        m.position.set(r.uniform(-0.06, 0.06), s / 2 + (k > 6 ? 0.035 : 0), r.uniform(-0.04, 0.04)); m.rotation.y = r.uniform(0, 3);
      }
      break;
    }
  }
  g.add(body);
  // 바닥 경계 빛 (딱딱 = 빨강: 이 안에 토리 몸 중심이 들어오면 부딪힘 / 푹신 = 파랑)
  const rad = Math.max(hx, hy) + R_BODY;
  const zone = new THREE.Mesh(new THREE.CircleGeometry(rad, 40), new THREE.MeshBasicMaterial({ color: soft ? 0x7DD3FC : 0xF87171, transparent: true, opacity: soft ? 0.05 : 0.07, depthWrite: false }));
  zone.rotation.x = -Math.PI / 2; zone.position.y = 0.0015; zone.name = "zone"; g.add(zone);
  const selRing = new THREE.Mesh(new THREE.RingGeometry(rad - 0.008, rad, 48), new THREE.MeshBasicMaterial({ color: 0xFACC15, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.003; selRing.visible = false; selRing.name = "sel"; g.add(selRing);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(hx, hy) + 0.02, Math.max(hx, hy) + 0.02, 0.12, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.06; g.add(hit);
  return { g, hit };
}
function syncObjects() {
  const ids = new Set(room.items.map(o => o.id));
  for (const [id, m] of objMeshes) if (!ids.has(id)) { objGroup.remove(m.g); objMeshes.delete(id); }
  for (const o of room.items) {
    let m = objMeshes.get(o.id);
    if (!m) { m = makeObject(o.name); m.hit.userData.pick = { kind: "obj", id: o.id }; objGroup.add(m.g); objMeshes.set(o.id, m); }
    m.g.position.copy(V3(o.x, o.y)); m.g.rotation.y = o.yaw;
    m.g.getObjectByName("sel").visible = ui.sel === o.id;
  }
  flag.position.copy(V3(room.F.x, room.F.y));
  startPad.position.copy(V3(room.S.x, room.S.y));
  $("btnDel").disabled = ui.sel === null;
}

// ---------------- 토리 (도토리 로봇) ----------------
function makeTori() {
  const t = new THREE.Group(), m = {};
  const ochre = std(0xC8902E, { roughness: 0.55 }), green = std(0x4E7A35, { roughness: 0.6 }), wood = std(0xC79A5B, { roughness: 0.7 });
  const cap = std(0x6B4423, { roughness: 0.85 }), dark = std(0x2F3238, { roughness: 0.5, metalness: 0.3 }), orange = std(0xC2602F, { roughness: 0.5 }), boot = std(0x8E3B2A, { roughness: 0.6 });
  const body = new THREE.Group(); t.add(body); m.body = body;
  const add = (p, mesh) => { mesh.castShadow = true; p.add(mesh); return mesh; };
  const torso = add(body, new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 24), ochre)); torso.scale.set(1.0, 1.05, 1.05); torso.position.y = 0.135;
  const belt = add(body, new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.009, 10, 40), green)); belt.rotation.x = Math.PI / 2; belt.position.y = 0.105;
  const collar = add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.066, 0.03, 32), green)); collar.position.y = 0.19;
  const head = add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.075, 32), wood)); head.position.y = 0.225;
  // 모자: 비늘 무늬 반구 + 꼭지
  const capG = new THREE.SphereGeometry(0.062, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = capG.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i); const a = Math.atan2(v.z, v.x), e = Math.asin(Math.min(1, v.y / 0.062));
    const bump = 1 + 0.035 * Math.max(0, Math.sin(a * 14 + (Math.floor(e * 9) % 2) * Math.PI / 2) * Math.sin(e * 28));
    v.multiplyScalar(bump); pos.setXYZ(i, v.x, v.y, v.z);
  }
  capG.computeVertexNormals();
  const capM = add(body, new THREE.Mesh(capG, cap)); capM.scale.set(1, 0.82, 1); capM.position.y = 0.255;
  const rim = add(body, new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.007, 8, 40), cap)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.256;
  const stem = add(body, new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.03, 10), std(0x5B3A1E))); stem.position.set(-0.004, 0.318, 0); stem.rotation.z = 0.35;
  // 눈 (앞 = +x) — 호박색 빛
  m.eyes = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.Group(); eg.position.set(0.043, 0.232, s * 0.02);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 20, 14), new THREE.MeshStandardMaterial({ color: 0xFFB547, emissive: 0xFFA22E, emissiveIntensity: 2.2 }));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1A1209, roughness: 0.2 }));
    pupil.position.x = 0.007; const hl = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), new THREE.MeshBasicMaterial({ color: 0xFFFFFF }));
    hl.position.set(0.013, 0.003, -0.002 * s);
    eg.add(glow, pupil, hl); body.add(eg); m.eyes.push(eg);
  }
  // 나뭇잎 귀
  for (const s of [-1, 1]) {
    const leaf = add(body, new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), std(0x6E9A45, { roughness: 0.6 })));
    leaf.scale.set(0.5, 0.18, 1.25); leaf.position.set(-0.005, 0.165, s * 0.082); leaf.rotation.set(s * 0.5, 0.3 * s, 0.4);
  }
  // 다리 (엉덩이 축에서 흔들림) + 장화
  m.legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, 0.085, s * 0.036); t.add(hip);
    const joint = add(hip, new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.026, 18), dark)); joint.rotation.x = Math.PI / 2;
    const link = add(hip, new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.06, 0.008, 2, 0.003), orange)); link.position.set(0, -0.03, s * 0.016);
    const shin = add(hip, new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.05, 0.02, 2, 0.003), dark)); shin.position.y = -0.04;
    const bt = add(hip, new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.032, 0.038, 3, 0.01), boot)); bt.position.set(0.01, -0.069, 0);
    const sole = add(hip, new THREE.Mesh(new RoundedBoxGeometry(0.064, 0.008, 0.04, 2, 0.003), dark)); sole.position.set(0.01, -0.083, 0);
    m.legs.push(hip);
  }
  // 몸 경계 고리 (반지름 11 cm) · 조심 고리 (18 cm)
  const r1 = new THREE.Mesh(new THREE.RingGeometry(R_BODY - 0.004, R_BODY, 56), new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  r1.rotation.x = -Math.PI / 2; r1.position.y = 0.004; t.add(r1);
  const r2 = new THREE.Mesh(new THREE.RingGeometry(R_WARN - 0.003, R_WARN, 56), new THREE.MeshBasicMaterial({ color: 0xF87171, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
  r2.rotation.x = -Math.PI / 2; r2.position.y = 0.004; t.add(r2); m.warn = r2;
  // 앞 거리센서 빛줄기
  const ray = new THREE.Mesh(new THREE.BoxGeometry(1, 0.003, 0.003), new THREE.MeshBasicMaterial({ color: 0xFF5A47 }));
  ray.position.set(0.5, 0.05, 0); t.add(ray); m.ray = ray;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: 0xFF5A47 })); dot.position.y = 0.05; t.add(dot); m.dot = dot;
  t.userData = m; return t;
}
const tori = makeTori(); scene.add(tori);
// 가까운 물건 보는 선
const seeGeo = new THREE.BufferGeometry(); seeGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(K_OBJ * 6), 3));
const seeLines = new THREE.LineSegments(seeGeo, new THREE.LineBasicMaterial({ color: 0x7DD3FC, transparent: true, opacity: 0.55 })); scene.add(seeLines);
// 발자취 (이번 · 지난번)
const TRAIL_N = 400;
function makeTrail(color, size, opacity) {
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_N * 3), 3)); geo.setDrawRange(0, 0);
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false })); scene.add(p); return p;
}
const trail = makeTrail(0xFACC15, 0.018, 0.9), trailOld = makeTrail(0x94A3B8, 0.012, 0.35);
let trailPts = [];
function pushTrail(x, y) {
  trailPts.push(x, 0.006, -y); if (trailPts.length > TRAIL_N * 3) trailPts.splice(0, 3);
  trail.geometry.attributes.position.array.set(trailPts); trail.geometry.attributes.position.needsUpdate = true; trail.geometry.setDrawRange(0, trailPts.length / 3);
}
function archiveTrail() {
  trailOld.geometry.attributes.position.array.set(trailPts); trailOld.geometry.attributes.position.needsUpdate = true; trailOld.geometry.setDrawRange(0, trailPts.length / 3);
  trailPts = []; trail.geometry.setDrawRange(0, 0);
}

// ---------------- 시연 (메인 화면의 토리 한 마리) ----------------
const demo = { env: new NavEnv(1, (Math.random() * 1e6) | 0, { noise: true }), lane: null, prev: null, cur: null, acc: 0, a: 0, p: new Float32Array(NA), end: 0, kind: "", near: new Int32Array(K_OBJ), obs: new Float32Array(OBS_DIM), rng: new RNG(99), walk: 0 };
function demoBrain() { return ui.brain === "teacher" ? teacher : student; }
function demoReset() {
  demo.lane = roomToLane(room.S, room.F, room.items);
  demo.env.reset(0, { G: demo.lane.G, objs: demo.lane.objs });
  const st = demo.env.st;
  demo.cur = [st[0], st[1], st[2]]; demo.prev = demo.cur.slice(); demo.acc = 0; demo.end = 0; demo.kind = "";
  archiveTrail(); decide();
}
function decide() {
  const pi = demoBrain(); if (!pi) return;
  demo.env.obsInto(0, demo.obs, 0, demo.near);
  softmax(pi.forward1(demo.obs), 0, NA, demo.p);
  demo.a = ui.mode === "greedy" ? argmax(demo.p) : sampleCat(demo.p, demo.rng);
  drawBars();
}
const TOAST = { win: ["도착!", "#4ADE80", "깃발에 닿았어요"], crash: ["쿵! 부딪힘", "#F87171", "딱딱한 물건에 닿았어요"], out: ["길 벗어남", "#FFB547", "길 폭 1.4 m 밖으로 나갔어요"], tout: ["시간 초과", "#A78BFA", "30초 안에 못 갔어요"] };
function demoTick(dt) {
  if (ui.demoPaused || !demoBrain()) return;
  if (demo.end > 0) { demo.end -= dt; if (demo.end <= 0) { hideToast(); demoReset(); } return; }
  demo.acc += dt * ui.speed;
  while (demo.acc >= DT_DEC) {
    demo.acc -= DT_DEC;
    demo.prev = demo.cur.slice();
    const r = demo.env.stepRew(0, demo.a);
    const st = demo.env.st; demo.cur = [st[0], st[1], st[2]];
    if (r.done) { demo.kind = r.kind; demo.acc = 0; const vd = showToast(r.kind, demo.env.t[0]); demo.end = Math.max(1.6, vd + 0.35); break; }   // 목소리가 끝난 뒤 다음 판
    decide();
  }
}
function demoPose() {
  const f = demo.end > 0 ? 1 : Math.min(1, demo.acc / DT_DEC);
  const p = demo.prev, c = demo.cur;
  let dyaw = c[2] - p[2]; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const x = p[0] + (c[0] - p[0]) * f, y = p[1] + (c[1] - p[1]) * f, yaw = p[2] + dyaw * f;
  return laneToRoom(room.S, demo.lane.th, x, y, yaw);
}
let lastTrail = 0, blink = 3;
function updateTori(dt, time) {
  if (!demo.lane) return;
  const P = demoPose();
  tori.position.copy(V3(P.x, P.y)); tori.rotation.y = P.yaw;
  if (time - lastTrail > 0.05 && demo.end <= 0) { pushTrail(P.x, P.y); lastTrail = time; }
  // 걷는 모양
  const v = demo.env.vel, sp = Math.hypot(v[0], v[1]) + Math.abs(v[2]) * 0.06;
  const moving = demo.end <= 0 && !ui.demoPaused;
  demo.walk += dt * (moving ? 6 + sp * 40 : 0) * Math.max(ui.speed, 1) ** 0.5;
  const amp = moving ? Math.min(0.45, 0.12 + sp * 2.2) : 0;
  const m = tori.userData;
  m.legs[0].rotation.z = Math.sin(demo.walk) * amp; m.legs[1].rotation.z = -Math.sin(demo.walk) * amp;
  m.body.position.y = Math.abs(Math.sin(demo.walk)) * 0.006 * (amp > 0 ? 1 : 0);
  m.body.rotation.x = Math.sin(demo.walk) * 0.04 * (amp > 0 ? 1 : 0);
  m.body.rotation.z = demo.kind === "crash" && demo.end > 0 ? -0.25 : (v[0] * 0.25);
  blink -= dt; const closed = blink < 0.12; if (blink < 0) blink = 2 + Math.random() * 3;
  m.eyes.forEach(e => (e.scale.y = closed ? 0.15 : 1));
  // 센서
  const tof = demo.env.tof(0);
  m.ray.scale.x = Math.max(0.001, tof); m.ray.position.x = 0.06 + tof / 2; m.dot.position.x = 0.06 + tof;
  m.ray.visible = m.dot.visible = tof < 0.6;
  let dh = 9; for (let j = 0; j < M_MAX; j++) if (demo.env.on[j] && demo.env.obj[j * 8 + 7] === 0) dh = Math.min(dh, demo.env.dist(0, j));
  m.warn.material.opacity = dh < R_WARN ? 0.55 : 0.15;
  // 보는 선
  const arr = seeGeo.attributes.position.array; let n = 0;
  for (let q = 0; q < K_OBJ; q++) {
    const j = demo.near[q]; if (j < 0 || j >= room.items.length) continue;
    const o = room.items[j];
    arr.set([P.x, 0.12, -P.y, o.x, 0.03, -o.y], n * 6); n++;
  }
  seeGeo.setDrawRange(0, n * 2); seeGeo.attributes.position.needsUpdate = true;
  // 숫자
  const gd = Math.hypot(demo.lane.G - demo.env.st[0], demo.env.st[1]);
  $("sGoal").textContent = `${(gd * 100).toFixed(0)} cm`;
  $("sTof").textContent = tof < 0.6 ? `${(tof * 100).toFixed(0)} cm` : "비어 있음";
  $("sNear").textContent = dh < 9 ? `${Math.max(0, (dh - R_BODY) * 100).toFixed(0)} cm 남음` : "없음";
  $("sTime").textContent = `${demo.env.t[0].toFixed(1)} 초`;
  $("tofbar").firstElementChild.style.width = `${(tof / 0.6) * 100}%`;
}

// ---------------- 명령 막대 ----------------
const barsEl = $("bars");
ACT_NAMES.forEach((nm, k) => {
  const d = document.createElement("div"); d.className = "bar";
  d.innerHTML = `<div class="fill"></div><div class="ic">${ACT_ICONS[k]}</div><div class="nm">${nm}</div>`;
  d.title = nm; barsEl.appendChild(d);
});
function drawBars() {
  const kids = barsEl.children;
  for (let k = 0; k < NA; k++) {
    kids[k].classList.toggle("on", k === demo.a);
    kids[k].firstElementChild.style.height = `${Math.max(2, demo.p[k] * 100)}%`;
  }
}

// ---------------- 알림 ----------------
const toastEl = $("toast");
function showToast(kind, t) {
  const [txt, col, sub] = TOAST[kind];
  toastEl.innerHTML = `${txt}<small>${sub} · ${t.toFixed(1)}초</small>`; toastEl.style.color = col; toastEl.classList.add("show");
  return train.running ? say(kind) : 0;   // 토리 목소리는 학습 중에만 (멈춘 뒤 시연은 조용히) → 말하는 길이 (초)
}
function hideToast() { toastEl.classList.remove("show"); }

// ---------------- 학습 워커 ----------------
// ---------- 학습 조건 (초보자용 쉬운 조건 + 전문가용) ----------
// [키, 이름, 설명, 기본값, 최소, 최대, 칸 간격, 묶음]  묶음: e=쉬운 조건, p=전문가용 PPO, r=전문가용 점수
const CFG_SPEC = [
  ["crash", "부딪힘 감점", "딱딱한 물건에 부딪히면 깎는 점수 (판 끝)", REW_DEFAULT.crash, 0, 50, 0.5, "e"],
  ["out", "길 벗어남 감점", "폭 1.4 m 길 밖으로 나가면 (판 끝)", REW_DEFAULT.out, 0, 50, 0.5, "e"],
  ["win", "도착 점수", "깃발에 닿으면 주는 점수", REW_DEFAULT.win, 0, 50, 0.5, "e"],
  ["prog", "깃발로 다가가기 점수", "가까워진 거리(m) × 이 값, 걸음마다", REW_DEFAULT.prog, 0, 30, 0.5, "e"],
  ["near", "물건 가까이 감점", "딱딱한 물건 18 cm 안에 들어가면", REW_DEFAULT.near, 0, 10, 0.1, "e"],
  ["face", "깃발 바라보기 점수", "깃발 쪽을 보고 있을수록 + (기본 꺼짐 0)", REW_DEFAULT.face, 0, 1, 0.01, "e"],
  ["time", "시간 감점", "걸음(0.2초)마다 조금씩 깎기 → 서두르게 됨", REW_DEFAULT.time, 0, 1, 0.01, "e"],
  ["entStart", "탐험 정도", "클수록 이것저것 해 봄 (처음 값, 점점 줄어듦)", PPO_DEFAULT.entStart, 0, 0.2, 0.005, "e"],
  ["tMax", "한 판 제한 시간 (초)", "이 시간 안에 못 가면 그 판은 끝", REW_DEFAULT.tMax, 5, 120, 1, "e"],
  ["maxSteps", "총 걸음 수 (천 걸음)", "경험한 걸음이 이만큼 × 1,000 이 되면 스스로 멈춤 (0 = 계속)", 0, 0, 100000, 50, "e"],
  ["maxIters", "자동 멈춤 반복 수", "이만큼 학습하면 스스로 멈춤 (0 = 계속)", 0, 0, 5000, 10, "e"],
  ["horizon", "한 번에 모으는 걸음 수", "세상 하나당. 반복 한 번 = 세상 수 × 이 값", PPO_DEFAULT.horizon, 8, 512, 8, "p"],
  ["epochs", "고치기 횟수", "모은 경험으로 두뇌를 몇 번 고칠까", PPO_DEFAULT.epochs, 1, 20, 1, "p"],
  ["mb", "묶음 크기 (minibatch)", "한 번 고칠 때 보는 경험 수", PPO_DEFAULT.mb, 64, 16384, 64, "p"],
  ["gamma", "먼 미래 중요도 (γ)", "1에 가까울수록 멀리 보고 판단", PPO_DEFAULT.gamma, 0.8, 0.999, 0.001, "p"],
  ["lam", "GAE λ", "점수 몫 나누기 정도", PPO_DEFAULT.lam, 0.8, 1, 0.01, "p"],
  ["clip", "한 번에 바꾸는 폭 (clip)", "작을수록 조심스럽게 고침", PPO_DEFAULT.clip, 0.05, 0.5, 0.01, "p"],
  ["entEnd", "탐험 정도 (마지막)", "탐험이 줄어드는 바닥값", PPO_DEFAULT.entEnd, 0, 0.1, 0.001, "p"],
  ["entIters", "탐험 줄이는 기간", "이 반복 수에 걸쳐 처음→마지막으로", PPO_DEFAULT.entIters, 1, 5000, 10, "p"],
  ["hidden", "두뇌 크기 (층당 뉴런)", "✦ 새 두뇌를 눌러야 적용", PPO_DEFAULT.hidden, 16, 256, 16, "p"],
  ["lane", "길 가운데서 벗어남 감점", "가운데에서 15 cm 넘게 벗어나면", REW_DEFAULT.lane, 0, 2, 0.01, "r"],
  ["soft", "양말·손수건 밟기 감점", "푹신한 물건은 밟아도 되지만 조금 −", REW_DEFAULT.soft, 0, 2, 0.01, "r"],
  ["head", "반대쪽 보기 감점", "깃발과 73°넘게 다른 쪽을 보면", REW_DEFAULT.head, 0, 2, 0.01, "r"],
  ["stop", "멈춤 감점", "멈춤 명령을 고르면", REW_DEFAULT.stop, 0, 1, 0.01, "r"],
  ["tout", "시간 초과 감점", "제한 시간 안에 못 가면 (판 끝)", REW_DEFAULT.tout, 0, 50, 0.5, "r"],
];
const W_KEYS = ["prog", "time", "lane", "near", "soft", "head", "face", "stop", "crash", "out", "win", "tout", "tMax"];
const CFG_DEF = Object.fromEntries(CFG_SPEC.map(r => [r[0], r[3]]));
const PRESETS = {
  base: {},
  safe: { crash: 10, out: 8, near: 1.5 },                 // 조심조심: 부딪힘을 아주 싫어함
  fast: { time: 0.06, prog: 7, stop: 0.05 },              // 빨리빨리: 시간 아까워함
  explore: { entStart: 0.06, entEnd: 0.01, entIters: 400 }, // 탐험 많이: 이것저것 오래 해 봄
};
const cfg = { v: { ...CFG_DEF }, hiddenLive: PPO_DEFAULT.hidden, t: null };
const cfgW = () => Object.fromEntries(W_KEYS.map(k => [k, cfg.v[k]]));
function cfgSay(t) { $("cfgMsg").textContent = t; }
function cfgBuild() {
  const box = $("cfgBox"); box.innerHTML = "";
  const groups = [["e", "쉬운 조건", "점수 규칙 · 탐험 · 학습 길이"], ["p", "전문가용 · PPO", ""], ["r", "전문가용 · 나머지 점수", ""]];
  for (const [g, title, sub] of groups) {
    let host = box;
    if (g !== "e") {
      let d = box.querySelector("details.pro");
      if (!d) { d = document.createElement("details"); d.className = "pro"; d.innerHTML = `<summary class="cfgGrp" style="cursor:pointer">전문가용 설정 열기 <small>PPO 세부값 · 나머지 점수</small></summary>`; box.appendChild(d); }
      host = d;
    }
    const h = document.createElement("div"); h.className = "cfgGrp"; h.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ""}`; host.appendChild(h);
    for (const [k, name, desc, def, mn, mx, st, grp] of CFG_SPEC) {
      if (grp !== g) continue;
      const row = document.createElement("div"); row.className = "cfgRow"; row.dataset.k = k;
      row.innerHTML = `<label for="cf_${k}">${name}<small>${desc} · 기본 ${def}</small></label><input id="cf_${k}" type="number" min="${mn}" max="${mx}" step="${st}" value="${cfg.v[k]}">`;
      row.querySelector("input").oninput = cfgRead;
      host.appendChild(row);
    }
  }
}
function cfgMark() {
  for (const row of document.querySelectorAll(".cfgRow")) row.classList.toggle("chg", cfg.v[row.dataset.k] !== CFG_DEF[row.dataset.k]);
}
function cfgRead() {
  let bad = 0;
  for (const [k, , , , mn, mx] of CFG_SPEC) {
    const inp = $(`cf_${k}`), v = parseFloat(inp.value), ok = Number.isFinite(v) && v >= mn && v <= mx;
    inp.parentElement.classList.toggle("bad", !ok);
    if (ok) cfg.v[k] = (k === "horizon" || k === "epochs" || k === "mb" || k === "entIters" || k === "hidden" || k === "maxIters" || k === "maxSteps") ? Math.round(v) : v; else bad++;
  }
  cfgMark();
  setSeg("presetSeg", "p", "");
  clearTimeout(cfg.t); cfg.t = setTimeout(() => cfgSend(bad), 250);
}
function cfgSend(bad = 0) {
  const c = cfg.v;
  worker.postMessage({ cmd: "cfg", cfg: { horizon: c.horizon, epochs: c.epochs, mb: c.mb, gamma: c.gamma, lam: c.lam, clip: c.clip, entStart: c.entStart, entEnd: c.entEnd, entIters: c.entIters, w: cfgW() } });
  const nChg = CFG_SPEC.filter(r => cfg.v[r[0]] !== r[3]).length;
  let msg = bad ? `빨간 칸 ${bad}개는 범위를 벗어나서 이전 값을 그대로 써요. ` : "";
  msg += nChg ? `바뀐 조건 ${nChg}개가 다음 반복부터 적용돼요.` : "모두 기본값이에요.";
  const per = train.nEnv * c.horizon;
  msg += ` 반복 한 번 = 세상 ${train.nEnv} × ${c.horizon}걸음 = ${per.toLocaleString()}걸음` + (c.maxSteps > 0 ? ` → 총 ${(c.maxSteps * 1000).toLocaleString()}걸음이면 약 ${Math.ceil(c.maxSteps * 1000 / per)}회 반복.` : ".");
  if (c.hidden !== cfg.hiddenLive) msg += ` 두뇌 크기 ${c.hidden}은 ✦ 새 두뇌를 누르면 적용돼요.`;
  cfgSay(msg);
}
function cfgSet(o = {}, quiet = false) {
  for (const k of Object.keys(CFG_DEF)) {
    let v = o[k]; if (v == null && o.w && o.w[k] != null) v = o.w[k];
    if (v != null && Number.isFinite(+v)) cfg.v[k] = +v;
  }
  for (const [k] of CFG_SPEC) $(`cf_${k}`).value = cfg.v[k];
  if (o.nEnv && [16, 32, 64, 128].includes(o.nEnv)) { train.nEnv = o.nEnv; setSeg("envSeg", "n", String(o.nEnv)); $("nEnvV").textContent = o.nEnv; }
  if (o.lr && [0.0005, 0.001, 0.002, 0.005].includes(o.lr)) { train.lr = o.lr; setSeg("lrSeg", "l", String(o.lr)); $("lrV").textContent = o.lr; worker.postMessage({ cmd: "lr", lr: o.lr }); }
  cfgMark(); if (!quiet) cfgSend(); else worker.postMessage({ cmd: "cfg", cfg: { ...cfg.v, w: cfgW() } });
}

const worker = new Worker(new URL("./nav.worker.js", import.meta.url), { type: "module" });
const train = { running: false, nEnv: 32, lr: 0.002, frac: 0.3, hist: [], watch: null, wT: 0, pending: null, from: "새 두뇌" };
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "weights") {
    if (!student || student.sizes[1] !== m.sizes[1]) student = new MLP(m.sizes);
    m.W.forEach((w, l) => student.W[l].set(w)); m.b.forEach((b, l) => student.b[l].set(b));
    studentIt = m.it; if (ui.brain === "student") $("brainName").textContent = `내 두뇌 · ${studentIt}회`;
  } else if (m.type === "stats") onStats(m.s);
  else if (m.type === "ready") { $("stIt").textContent = m.it; }
  else if (m.type === "brain" && train.pending) { const f = train.pending; train.pending = null; f(m.brain); }
};
function initWorker(brain = null) {
  const c = cfg.v;
  worker.postMessage({ cmd: "init", opts: {
    nEnv: train.nEnv, lr: train.lr, seed: (Math.random() * 1e6) | 0,
    hidden: c.hidden, horizon: c.horizon, epochs: c.epochs, mb: c.mb, gamma: c.gamma, lam: c.lam, clip: c.clip,
    entStart: c.entStart, entEnd: c.entEnd, entIters: c.entIters, w: cfgW(),
  }, brain });
  cfg.hiddenLive = brain ? (brain.hidden ?? c.hidden) : c.hidden; cfgMark();
  sendCourse();
  if (train.running) worker.postMessage({ cmd: "start" });
}
function sendCourse() {
  const L = roomToLane(room.S, room.F, room.items);
  worker.postMessage({ cmd: "course", course: { G: L.G, objs: L.objs }, frac: train.frac });
}
function getBrain(name) { return new Promise(res => { train.pending = res; worker.postMessage({ cmd: "getBrain", name }); }); }
const ema = (prev, v, a = 0.25) => (prev == null ? v : prev + a * (v - prev));
function onStats(s) {
  const last = train.hist[train.hist.length - 1];
  const row = { it: s.it, win: ema(last?.win, s.win), crash: ema(last?.crash, s.crash), course: s.courseWin == null ? last?.course ?? null : ema(last?.course, s.courseWin) };
  train.hist.push(row);
  $("stIt").textContent = s.it;
  $("stSteps").textContent = s.steps >= 1e6 ? `${(s.steps / 1e6).toFixed(2)}M` : `${Math.round(s.steps / 1000)}k`;
  $("stWin").textContent = `${Math.round(row.win * 100)}%`;
  $("stCrash").textContent = `${Math.round(row.crash * 100)}%`;
  $("stCourse").textContent = row.course == null ? "—" : `${Math.round(row.course * 100)}%`;
  $("stEnt").textContent = s.ent.toFixed(2);
  drawChart();
  train.watch = s.watch; train.wT = 0;
  $("wTitle").textContent = `반복 ${s.it} · ${s.ms} ms`;
  $("wNote").textContent = `지금 ${train.nEnv}개 세상에서 동시에 연습 중 (그중 6개). 반복 한 번 = ${train.nEnv * cfg.v.horizon}걸음 경험 → 두뇌 ${cfg.v.epochs}번 고치기.`;
  if (cfg.v.maxSteps > 0 && s.steps >= cfg.v.maxSteps * 1000 && train.running) { $("btnTrain").click(); cfgSay(`총 ${Math.round(s.steps / 1000)}천 걸음을 경험해서 자동으로 멈췄어요.`); }
  if (cfg.v.maxIters > 0 && s.it >= cfg.v.maxIters && train.running) { $("btnTrain").click(); cfgSay(`반복 ${s.it}회에 도달해서 자동으로 멈췄어요.`); }
}
function drawChart() {
  const cv = $("chart"), g = cv.getContext("2d"), W = cv.width, H = cv.height, P = { l: 44, r: 12, t: 12, b: 30 };
  g.clearRect(0, 0, W, H);
  g.font = "20px JetBrains Mono"; g.fillStyle = "#64748B"; g.strokeStyle = "rgba(148,163,184,.14)"; g.lineWidth = 1;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const y = P.t + (1 - v) * (H - P.t - P.b); g.beginPath(); g.moveTo(P.l, y); g.lineTo(W - P.r, y); g.stroke();
    g.fillText(`${v * 100}`, 4, y + 7);
  }
  const h = train.hist; const n = Math.max(h.length, 20);
  const X = i => P.l + (i / (n - 1)) * (W - P.l - P.r), Y = v => P.t + (1 - v) * (H - P.t - P.b);
  g.setLineDash([8, 8]); g.strokeStyle = "#94A3B8"; g.beginPath(); g.moveTo(P.l, Y(0.963)); g.lineTo(W - P.r, Y(0.963)); g.stroke(); g.setLineDash([]);
  const line = (key, col, w = 4) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineJoin = "round"; g.beginPath(); let st = false;
    h.forEach((r, i) => { if (r[key] == null) return; const x = X(i), y = Y(r[key]); if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y); });
    g.stroke();
  };
  line("crash", "#F87171", 3); line("course", "#FACC15", 3); line("win", "#4ADE80", 5);
  g.fillStyle = "#64748B"; g.fillText(h.length ? `반복 ${h[h.length - 1].it}` : "반복", W - P.r - 140, H - 6);
}
drawChart();

// 학습 세상 미리보기 (6 칸)
const wcv = $("wcv"), wg = wcv.getContext("2d");
function drawWorlds(dt) {
  const W = wcv.width, H = wcv.height; wg.clearRect(0, 0, W, H);
  const cols = 3, rows = 2, cw = W / cols, ch = H / rows;
  const wv = train.watch;
  if (!wv) {
    wg.fillStyle = "#475569"; wg.font = "22px Noto Sans KR"; wg.textAlign = "center"; wg.fillText("▶ 학습 시작을 누르면 여기서 연습해요", W / 2, H / 2 + 8); wg.textAlign = "left"; return;
  }
  train.wT += dt * 22; // 걸음/초
  for (let w = 0; w < Math.min(6, wv.length); w++) {
    const tile = wv[w], ox = (w % cols) * cw, oy = Math.floor(w / cols) * ch;
    const k = Math.min(tile.path.length - 1, Math.floor(train.wT));
    // 이 걸음이 몇 번째 판인지
    let objs = tile.objs, G = tile.G, from = 0, endKind = null;
    for (const e of tile.ends) { if (e.step <= k) { objs = e.next.objs; G = e.next.G; from = e.step + 1; if (k - e.step < 6) endKind = e.kind; } }
    const sx = (cw - 16) / 3.4, sy = sx, cx = ox + 8 + 0.25 * sx, cy = oy + ch / 2;
    const px = x => cx + x * sx, py = y => cy - y * sy;
    wg.fillStyle = "rgba(250,204,21,.06)"; wg.fillRect(px(-0.1), py(LANE_HALF), (G + 0.35) * sx, LANE_HALF * 2 * sy);
    wg.fillStyle = "rgba(74,222,128,.25)"; wg.fillRect(px(G), py(GOAL_HALF), 0.3 * sx, GOAL_HALF * 2 * sy);
    for (const o of objs) {
      const [hx, hy, c, s] = SHAPES[o.name];
      wg.fillStyle = s ? "#7DD3FC" : "#F87171";
      wg.save(); wg.translate(px(o.x), py(o.y)); wg.rotate(-o.yaw);
      const ex = Math.max(hx * sx, 3), ey = Math.max(hy * sy, 3);
      if (c) { wg.beginPath(); wg.arc(0, 0, ex, 0, 7); wg.fill(); } else wg.fillRect(-ex, -ey, 2 * ex, 2 * ey);
      wg.restore();
    }
    wg.strokeStyle = "rgba(250,204,21,.8)"; wg.lineWidth = 2; wg.beginPath();
    for (let i = from; i <= k; i++) { const q = tile.path[i]; i === from ? wg.moveTo(px(q[0]), py(q[1])) : wg.lineTo(px(q[0]), py(q[1])); }
    wg.stroke();
    const q = tile.path[k];
    wg.fillStyle = "#FDE68A"; wg.beginPath(); wg.arc(px(q[0]), py(q[1]), R_BODY * sx, 0, 7); wg.fill();
    wg.strokeStyle = "#111827"; wg.lineWidth = 2; wg.beginPath(); wg.moveTo(px(q[0]), py(q[1])); wg.lineTo(px(q[0] + Math.cos(q[2]) * 0.14), py(q[1] + Math.sin(q[2]) * 0.14)); wg.stroke();
    if (endKind) { wg.strokeStyle = { win: "#4ADE80", crash: "#F87171", out: "#FFB547", tout: "#A78BFA" }[endKind]; wg.lineWidth = 4; wg.strokeRect(ox + 3, oy + 3, cw - 6, ch - 6); }
    wg.strokeStyle = "rgba(148,163,184,.15)"; wg.lineWidth = 1; wg.strokeRect(ox + 0.5, oy + 0.5, cw - 1, ch - 1);
  }
  if (train.wT > 66) train.wT = 0;
}

// ---------------- 조작 ----------------
function setSeg(id, attr, val) { for (const b of $(id).children) b.classList.toggle("on", b.dataset[attr] === String(val)); }
$("brainSeg").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  ui.brain = b.dataset.b; setSeg("brainSeg", "b", ui.brain);
  $("brainName").textContent = ui.brain === "teacher" ? "선생님" : `내 두뇌 · ${studentIt}회`;
  $("brainHint").textContent = ui.brain === "teacher" ? "선생님 = 아리가 512개 세상에서 800번 학습시킨 두뇌 (무작위 코스 도착 96%)." : "내 두뇌 = 이 페이지에서 지금 키우는 두뇌. 학습 중에도 반복마다 새 두뇌로 바뀌어요.";
  demoReset();
};
$("spdSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.speed = +b.dataset.s; setSeg("spdSeg", "s", b.dataset.s); $("spdV").textContent = `${ui.speed}×`; };
$("modeSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.mode = b.dataset.m; setSeg("modeSeg", "m", ui.mode); };
$("btnRestart").onclick = () => { hideToast(); stopVoice(); demoReset(); };
$("btnPauseDemo").onclick = () => { ui.demoPaused = !ui.demoPaused; $("btnPauseDemo").textContent = ui.demoPaused ? "▶ 이어 걷기" : "⏸ 잠깐 멈춤"; $("bLive").textContent = ui.demoPaused ? "멈춤" : "시연 중"; };
$("btnTrain").onclick = () => {
  train.running = !train.running;
  worker.postMessage({ cmd: train.running ? "start" : "pause" });
  $("btnTrain").textContent = train.running ? "⏸ 학습 멈춤" : "▶ 학습 이어 하기";
  $("bLive").textContent = train.running ? "학습 중" : "시연 중";
  trainingMusic(train.running); if (train.running) sayNow("start"); else stopVoice();
  if (train.running && ui.brain === "teacher" && train.hist.length === 0) { ui.brain = "student"; setSeg("brainSeg", "b", "student"); $("brainName").textContent = "내 두뇌"; demoReset(); }
};
$("btnNew").onclick = () => { train.hist = []; drawChart(); train.from = "새 두뇌"; initWorker(null); setTimeout(demoReset, 50); };
$("btnFromTeacher").onclick = () => { train.hist = []; drawChart(); train.from = "선생님에서"; initWorker(teacherJSON); ui.brain = "student"; setSeg("brainSeg", "b", "student"); setTimeout(demoReset, 80); };
$("frac").oninput = (e) => { train.frac = e.target.value / 100; $("fracV").textContent = `${e.target.value}%`; sendCourse(); };
$("envSeg").onclick = async (e) => {
  const b = e.target.closest("button"); if (!b) return; train.nEnv = +b.dataset.n; setSeg("envSeg", "n", b.dataset.n); $("nEnvV").textContent = train.nEnv;
  const brain = await getBrain("이어서"); initWorker(brain);
};
$("lrSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; train.lr = +b.dataset.l; setSeg("lrSeg", "l", b.dataset.l); $("lrV").textContent = b.dataset.l; worker.postMessage({ cmd: "lr", lr: train.lr }); };
$("camSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.cam = b.dataset.c; setSeg("camSeg", "c", ui.cam); camPreset(); };

// 물건 고르기 판
const pal = $("palette");
const PAL = [["pointer", "고르기", "↖"], ...SNAMES.map(n => [n, SHAPE_KO[n], null])];
for (const [key, label, ic] of PAL) {
  const b = document.createElement("button"); b.dataset.k = key;
  const soft = key !== "pointer" && SHAPES[key][3];
  b.innerHTML = ic ? `<span style="font:700 14px var(--mono)">${ic}</span>${label}<small>옮기기</small>`
    : `<span class="sw" style="background:#${COLORS[key].toString(16).padStart(6, "0")}"></span>${label}<small>${soft ? "푹신 · 밟아도 됨" : `딱딱 · ${Math.round(Math.max(...SHAPES[key].slice(0, 2)) * 200)} cm`}</small>`;
  b.onclick = () => { ui.tool = key === "pointer" ? null : key; for (const c of pal.children) c.classList.toggle("on", c === b); renderer.domElement.style.cursor = ui.tool ? "crosshair" : ""; };
  pal.appendChild(b);
}
pal.firstElementChild.classList.add("on");

// 마우스: 끌기 · 놓기
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let drag = null, downAt = null;
function floorPoint(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(floorPlane, p)) return null;
  return { x: p.x, y: -p.z };
}
function pick(ev) {
  floorPoint(ev);
  const hits = ray.intersectObjects([...objGroup.children, flag, startPad], true).filter(h => h.object.userData.pick);
  return hits.length ? hits[0].object.userData.pick : null;
}
const clampFloor = (p) => ({ x: Math.min(FLOOR.x1, Math.max(FLOOR.x0, p.x)), y: Math.min(FLOOR.y1, Math.max(FLOOR.y0, p.y)) });
function clampFlag(F) {
  const dx = F.x - room.S.x, dy = F.y - room.S.y, d = Math.hypot(dx, dy) || 1;
  const k = Math.min(G_MAX, Math.max(G_MIN, d)) / d; return clampFloor({ x: room.S.x + dx * k, y: room.S.y + dy * k });
}
renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  downAt = { x: ev.clientX, y: ev.clientY };
  const pk = pick(ev);
  if (pk) {
    drag = pk; controls.enabled = false;
    if (pk.kind === "obj") { ui.sel = pk.id; syncObjects(); }
  }
});
renderer.domElement.addEventListener("pointermove", (ev) => {
  if (!drag) { renderer.domElement.style.cursor = ui.tool ? "crosshair" : (pick(ev) ? "grab" : ""); return; }
  const p = floorPoint(ev); if (!p) return;
  const q = clampFloor(p);
  if (drag.kind === "flag") room.F = clampFlag(q);
  else if (drag.kind === "start") { room.S = q; room.F = clampFlag(room.F); }
  else { const o = room.items.find(o => o.id === drag.id); if (o) { o.x = q.x; o.y = q.y; } }
  syncObjects(); rebuildLane(); renderer.domElement.style.cursor = "grabbing";
});
window.addEventListener("pointerup", (ev) => {
  const moved = downAt ? Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) : 99;
  if (drag) { drag = null; controls.enabled = true; courseChanged(); }
  else if (ui.tool && moved < 5 && ev.target === renderer.domElement) {
    if (room.items.length >= M_MAX) { flash("물건은 9개까지 놓을 수 있어요"); }
    else { const p = floorPoint(ev); if (p) { const q = clampFloor(p); const o = { id: nextId++, name: ui.tool, x: q.x, y: q.y, yaw: Math.random() * Math.PI }; room.items.push(o); ui.sel = o.id; syncObjects(); courseChanged(); } }
  } else if (!ui.tool && moved < 5 && ev.target === renderer.domElement) { ui.sel = null; syncObjects(); }
  downAt = null;
});
window.addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT") return;
  const o = room.items.find(o => o.id === ui.sel);
  if ((ev.key === "q" || ev.key === "Q") && o) { o.yaw += Math.PI / 12; syncObjects(); courseChanged(); }
  if ((ev.key === "e" || ev.key === "E") && o) { o.yaw -= Math.PI / 12; syncObjects(); courseChanged(); }
  if ((ev.key === "Delete" || ev.key === "Backspace") && o) delSel();
  if (ev.key === " ") { ev.preventDefault(); $("btnPauseDemo").click(); }
});
function delSel() { room.items = room.items.filter(o => o.id !== ui.sel); ui.sel = null; syncObjects(); courseChanged(); }
$("btnDel").onclick = delSel;
$("btnClear").onclick = () => { room.items = []; ui.sel = null; syncObjects(); courseChanged(); };
$("btnRandom").onclick = () => {
  const r = new RNG((Math.random() * 1e9) | 0);
  const dx = room.F.x - room.S.x, dy = room.F.y - room.S.y, G = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  room.items = randomScene(r, G).slice(0, M_MAX).map(o => { const P = laneToRoom(room.S, th, o.x, o.y, o.yaw); return { id: nextId++, name: o.name, ...clampFloor(P), yaw: P.yaw }; });
  ui.sel = null; syncObjects(); courseChanged();
};
let courseTimer = 0;
function courseChanged() { clearTimeout(courseTimer); courseTimer = setTimeout(() => { sendCourse(); hideToast(); stopVoice(); demoReset(); }, 120); }
function flash(msg) { toastEl.innerHTML = `<small style="font-size:16px">${msg}</small>`; toastEl.style.color = "#F1F5F9"; toastEl.classList.add("show"); setTimeout(hideToast, 1400); }

// 시험 20판
const dotsEl = $("dots"); for (let k = 0; k < 20; k++) dotsEl.appendChild(document.createElement("i"));
function runTest(which) {
  const pi = which === "teacher" ? teacher : student; if (!pi) return;
  const L = roomToLane(room.S, room.F, room.items);
  const res = evaluate(pi, { G: L.G, objs: L.objs }, 20, (Math.random() * 1e6) | 0);
  res.kinds.forEach((k, i) => (dotsEl.children[i].className = k));
  const nm = which === "teacher" ? "선생님" : `내 두뇌 (${studentIt}회)`;
  const tip = which === "student" && res.win < 10 ? `<br><span style="font:400 11.5px 'Noto Sans KR';color:var(--dim)">학습 중 '내 코스 도착'은 확률대로 고른 결과예요. 시험은 가장 높은 명령만 골라서, 아직 덜 배운 두뇌는 같은 실수를 되풀이할 수 있어요. 조금 더 학습시켜 보세요.</span>` : "";
  sayNow(res.win >= 16 ? "testgood" : "testbad");
  $("testres").innerHTML = `${nm}: <span style="color:var(--green)">도착 ${res.win}/20</span> · <span style="color:var(--red)">부딪힘 ${res.crash}</span> · 벗어남 ${res.out} · 시간초과 ${res.tout}${res.time ? ` · 평균 ${res.time.toFixed(1)}초` : ""}${tip}`;
}
$("btnTestT").onclick = () => runTest("teacher");
bindSoundButtons($("btnMusic"), $("btnVoice"));
$("btnTestS").onclick = () => runTest("student");

// 파일 받기 · 올리기
function download(name, obj) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("btnSaveW").onclick = () => download("tori_world.json", { kind: "tori-nav-world", version: 1, S: room.S, F: room.F, items: room.items.map(({ name, x, y, yaw }) => ({ name, x: +x.toFixed(3), y: +y.toFixed(3), yaw: +yaw.toFixed(3) })) });
$("btnSaveB").onclick = async () => { const b = await getBrain(`내 두뇌 (${train.from})`); download(`tori_brain_${b.iters}.json`, b); };
let fileFor = null;
$("btnLoadW").onclick = () => { fileFor = "world"; $("fileIn").click(); };
$("btnLoadB").onclick = () => { fileFor = "brain"; $("fileIn").click(); };
$("btnCfgSave").onclick = () => download("tori_lab_조건.json", { kind: "tori-lab-cfg", version: 1, cfg: { ...cfg.v, nEnv: train.nEnv, lr: train.lr } });
$("btnCfgLoad").onclick = () => { fileFor = "cfg"; $("fileIn").click(); };
cfgBuild();
$("btnCfgReset").onclick = () => { cfg.v = { ...CFG_DEF }; cfgSet({}); setSeg("presetSeg", "p", "base"); };
$("presetSeg").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const keepH = cfg.v.hidden, keepM = cfg.v.maxIters, keepS = cfg.v.maxSteps;
  cfg.v = { ...CFG_DEF, ...PRESETS[b.dataset.p], hidden: keepH, maxIters: keepM, maxSteps: keepS }; cfgSet({});
  setSeg("presetSeg", "p", b.dataset.p);
  const name = { base: "기본", safe: "조심조심 (부딪힘 감점 10 · 물건 가까이 1.5)", fast: "빨리빨리 (시간 감점 0.06 · 다가가기 7)", explore: "탐험 많이 (탐험 0.06 → 0.01, 400회)" }[b.dataset.p];
  cfgSay(`빠른 설정: ${name}. 바로 적용돼요. ✦ 새 두뇌로 처음부터 배워 보면 차이가 잘 보여요.`);
};
$("fileIn").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.kind === "tori-nav-world") { room.S = j.S; room.F = clampFlag(j.F); room.items = j.items.slice(0, M_MAX).map(o => ({ ...o, id: nextId++ })); ui.sel = null; syncObjects(); rebuildLane(); courseChanged(); flash("코스를 열었어요"); }
    else if (j.kind === "tori-lab-cfg") { cfgSet(j.cfg); cfgSay("조건 파일을 열었어요."); }
    else if (j.kind === "tori-nav-brain" && j.obs === OBS_DIM) { if (j.cfg) cfgSet({ ...j.cfg, hidden: j.hidden }, true); train.hist = []; drawChart(); train.from = j.name || "올린 두뇌"; initWorker(j); ui.brain = "student"; setSeg("brainSeg", "b", "student"); setTimeout(demoReset, 80); flash(`두뇌를 올렸어요 · ${j.iters ?? 0}회 학습분`); }
    else flash("토리 길 찾기 파일이 아니에요");
  } catch { flash("파일을 읽지 못했어요"); }
};

// ---------------- 카메라 ----------------
const camGoal = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), active: false };
function camPreset() {
  const mid = V3((room.S.x + room.F.x) / 2, (room.S.y + room.F.y) / 2);
  if (ui.cam === "iso") { camGoal.pos.copy(mid).add(new THREE.Vector3(-2.3, 2.7, 3.2)); camGoal.tgt.copy(mid); camGoal.active = true; }
  if (ui.cam === "top") { camGoal.pos.copy(mid).add(new THREE.Vector3(0, 4.2, 0.01)); camGoal.tgt.copy(mid); camGoal.active = true; }
}
function camFollow() {
  if (ui.cam !== "follow" || !demo.lane) return;
  const P = demoPose(), back = new THREE.Vector3(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
  const want = V3(P.x, P.y, 0.42).add(back.multiplyScalar(0.75));
  camera.position.lerp(want, 0.06); controls.target.lerp(V3(P.x, P.y, 0.1).add(new THREE.Vector3(Math.cos(P.yaw) * 0.4, 0, -Math.sin(P.yaw) * 0.4)), 0.1);
}

// ---------------- 크기 · 그리기 ----------------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;
  demoTick(dt); updateTori(dt, time);
  const ring = flag.getObjectByName("ring"); const s = 1 + 0.15 * Math.sin(time * 3); ring.scale.set(s, s, s);
  flag.getObjectByName("cloth").rotation.y = Math.sin(time * 2.2) * 0.25;
  if (camGoal.active) { camera.position.lerp(camGoal.pos, 0.08); controls.target.lerp(camGoal.tgt, 0.1); if (camera.position.distanceTo(camGoal.pos) < 0.01) camGoal.active = false; }
  camFollow();
  controls.update();
  requestAnimationFrame(frame);
  try { drawWorlds(dt); } catch (err) { console.error(err); }
  composer.render();
}

// ---------------- 시작 ----------------
(async function boot() {
  resize();
  teacherJSON = await (await fetch("teacher_v2.json")).json();
  teacher = MLP.fromJSON(teacherJSON.pi);
  syncObjects(); rebuildLane(); camPreset();
  initWorker(null);
  demoReset();
  $("loading").classList.add("hide");
  frame();
})();

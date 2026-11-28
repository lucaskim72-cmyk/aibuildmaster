// AI BUILD MASTER · City Chase. One deterministic timeline drives three ways of watching it:
//  - desktop / phone: the 30 s shot plays in a loop with the HUD (drag to look around, click a car)
//  - ?render=1: frame-exact rendering for the 1080x1920 video (window.__renderAt(t) returns a JPEG data URL)
//  - Meta Quest: Enter VR puts you in the driver's seat, endless chase; trigger / pinch on nothing = drone view
import { THREE, chime } from 'connect-xr';
import { createSim } from './sim.js';
import { buildWorld, cityEnvironment, glowMaterial, glowPoints, streakMaterial, streakGeo, FOG, FOG_DENSITY } from './world.js';
import { buildHero, buildPolice, buildTraffic, EYE } from './cars.js';
import { shot, applyShot, heroMatrix, bob, T } from './director.js';
import { createHUD } from './hud.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const START_T = parseFloat(params.get('t') || '0') || 0;
document.documentElement.classList.toggle('render', RENDER);

const app = window.__app; // made by createXRApp in index.html
const { scene, camera, renderer } = app;
app.controls.enabled = false; // the director drives the camera; we add our own drag-to-look below
renderer.toneMappingExposure = 0.95;
camera.near = 0.02; camera.far = 2600; camera.updateProjectionMatrix();
scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);

const env = cityEnvironment(renderer);
const glowMat = glowMaterial();

// everything that belongs to the moving world sits in `rig`, so XR can seat you in the car by moving the rig
const rig = new THREE.Group(); rig.matrixAutoUpdate = false; scene.add(rig);
const world = buildWorld({ scene: rig, renderer, env, glowMat });
// sky, skyline and rain follow the camera: keep them at scene level
for (const o of [world.sky, world.far, world.rain]) { rig.remove(o); scene.add(o); }

scene.add(new THREE.HemisphereLight(0x33456e, 0x050608, 1.1));
const moon = new THREE.DirectionalLight(0x9fb4ff, 0.7); moon.position.set(-30, 60, -40); scene.add(moon);
const siren = new THREE.PointLight(0xff2030, 0, 40, 2); rig.add(siren);

const sim = createSim(11);
const hero = buildHero(env); rig.add(hero.group);
const police = [buildPolice(env, 0), buildPolice(env, 1)]; police.forEach((p) => rig.add(p.group));
const traffic = buildTraffic(env, sim.state.traffic); rig.add(traffic.group);
const glows = glowPoints(160, glowMat); rig.add(glows.points);
const refl = new THREE.InstancedMesh(streakGeo(), streakMaterial(), 90); refl.frustumCulled = false; refl.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
refl.setColorAt(0, new THREE.Color()); rig.add(refl);

// windshield white-out glow (same shape as the glass)
const windGlow = new THREE.Mesh(hero.windshield.geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
windGlow.renderOrder = 6; hero.cockpit.add(windGlow);

// tail-light trails: two camera-facing ribbons from the car's recent path
const TRAIL_N = 44;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * TRAIL_N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2 * TRAIL_N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
{ const idx = []; for (let r = 0; r < 2; r++) for (let i = 0; i < TRAIL_N - 1; i++) { const a = (r * TRAIL_N + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trails = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
trails.frustumCulled = false; rig.add(trails);

// drift sparks
const sparkGeo = new THREE.BufferGeometry();
const NSP = sim.state.sparks.length;
sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NSP * 6), 3).setUsage(THREE.DynamicDrawUsage));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NSP * 6), 3).setUsage(THREE.DynamicDrawUsage));
const sparks = new THREE.LineSegments(sparkGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
sparks.frustumCulled = false; rig.add(sparks);

// rear-view mirror camera
const mirrorCam = new THREE.PerspectiveCamera(22, 512 / 148, 0.1, 500);

// HUD canvas over the 3D view
const hudCanvas = document.getElementById('hud');
const hud = createHUD(hudCanvas);
const sizeHUD = () => hud.resize(innerWidth, innerHeight, RENDER ? 1 : Math.min(devicePixelRatio || 1, 2));
sizeHUD(); addEventListener('resize', sizeHUD);

// XR dashboard panel (the 2D HUD cannot follow you into the headset, so a small screen on the dash does)
const xrPanelCanvas = document.createElement('canvas'); xrPanelCanvas.width = 768; xrPanelCanvas.height = 400;
const xrPanelTex = new THREE.CanvasTexture(xrPanelCanvas); xrPanelTex.colorSpace = THREE.SRGBColorSpace;
const xrPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.177), new THREE.MeshBasicMaterial({ map: xrPanelTex, toneMapped: false, transparent: true }));
xrPanel.position.set(0.36, 0.93, -0.36); xrPanel.lookAt(new THREE.Vector3(EYE.x, EYE.y, EYE.z)); xrPanel.visible = false;
hero.cockpit.add(xrPanel);

// ---------------------------------------------------------------- per-frame update
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), E = new THREE.Euler(), COL = new THREE.Color();
const look = { yaw: 0, pitch: 0, dragging: false };
let lastShot = null, xrMode = 'desktop', xrView = 'cockpit', xrSeat = null, xrT0 = 0;

function flash(t, i) { // police strobe: red double-flash, then blue double-flash
  const ph = (t * 2.6 + i * 0.37) % 1;
  const red = (ph < 0.1 || (ph > 0.17 && ph < 0.27)) ? 1 : 0;
  const blue = ((ph > 0.5 && ph < 0.6) || (ph > 0.67 && ph < 0.77)) ? 1 : 0;
  return { red, blue };
}

function update(t, dt) {
  const S = sim.advanceTo(t);
  const sh = shot(Math.min(t, 30), S);
  if (xrMode !== 'desktop') { sh.phase = 'pov'; sh.white = 0; sh.logo = 0; }
  lastShot = sh;

  // hero
  hero.group.position.set(S.hero.x, bob(t), 0);
  hero.group.rotation.set(0, S.hero.yaw, S.hero.roll, 'YXZ');
  const spin = -S.s / 0.36; hero.wheels.forEach((w) => (w.rotation.x = spin));
  hero.wheel.rotation.z = THREE.MathUtils.clamp(-S.hero.vx * 0.2 - S.hero.ax * 0.012, -1.4, 1.4);
  hero.cockpit.visible = t > 14.0 || xrMode !== 'desktop';
  const seated = (xrMode === 'vr' && xrView === 'cockpit') || (xrMode === 'desktop' && t > 14.9);
  hero.body.visible = !seated; hero.hood.visible = seated;
  trails.visible = !(xrMode === 'desktop' ? t > 14.2 : xrView === 'cockpit');
  hero.windMat.map.offset.y = (t * 0.06) % 1;
  windGlow.material.opacity = Math.min(1, sh.white * 4.5); // the glass blazes first, the rest of the frame follows

  // police
  S.police.forEach((p, i) => {
    const g = police[i].group;
    g.position.set(p.x, bob(t + i), p.z); g.rotation.set(0, p.yaw, p.roll, 'YXZ');
    const f = flash(t, i);
    police[i].red.color.setRGB(0.25 + f.red * 7, 0.02, 0.02); police[i].blue.color.setRGB(0.02, 0.05, 0.25 + f.blue * 8);
  });
  const f0 = flash(t, 0);
  siren.position.set(S.police[0].x, 2.2, S.police[0].z);
  siren.color.setRGB(f0.red ? 1 : 0.1, 0.06, f0.blue ? 1 : 0.1);
  siren.intensity = (f0.red || f0.blue) ? 170 : 20;

  traffic.update(S.traffic);
  world.update(S.s, t, camera);
  world.rainMat.uniforms.uAlpha.value = 0.32 * (1 - sh.white);

  // glows + road reflections for every car light
  glows.begin(); let ri = 0;
  const addRefl = (x, z, w, l, r, g, b) => { if (ri >= 90) return; M.compose(P.set(x, 0.025, z), Q.identity(), SC.set(w, 1, l)); refl.setMatrixAt(ri, M); refl.setColorAt(ri++, COL.setRGB(r, g, b)); };
  for (const c of S.traffic) {
    const ty = c.kind === 'truck' ? 0.75 : 0.78 * (c.kind === 'van' ? 1.3 : 1), tz = c.z + c.len / 2 + 0.05, sx = c.kind === 'truck' ? 0.81 : 0.62;
    glows.add(c.x - sx, ty, tz, 1.0, 0.08, 0.04, 0.75); glows.add(c.x + sx, ty, tz, 1.0, 0.08, 0.04, 0.75);
    addRefl(c.x, tz + 3.8, 1.7, 7.5, 0.55, 0.04, 0.03);
  }
  const hz = 2.53;
  hero.group.updateMatrix(); // glows live in the rig, so use the car's matrix inside the rig
  for (const sx of [-0.72, 0.72]) { P.set(sx, 0.8, hz).applyMatrix4(hero.group.matrix); glows.add(P.x, P.y, P.z, 1.0, 0.1, 0.05, 1.0); }
  for (const sx of [-0.62, 0.62]) { P.set(sx, 0.62, -2.15).applyMatrix4(hero.group.matrix); glows.add(P.x, P.y, P.z, 0.8, 0.85, 1.0, 0.9); }
  addRefl(S.hero.x, 6.8, 1.9, 8.5, 0.7, 0.05, 0.03);
  addRefl(S.hero.x, -12, 4.2, 17, 0.32, 0.33, 0.38);
  S.police.forEach((p, i) => {
    const f = flash(t, i), g = police[i].group; g.updateMatrix();
    P.set(-0.3, 1.5, 0.2).applyMatrix4(g.matrix); glows.add(P.x, P.y, P.z, 1.0, 0.05, 0.08, f.red ? 4.2 : 0.5);
    P.set(0.3, 1.5, 0.2).applyMatrix4(g.matrix); glows.add(P.x, P.y, P.z, 0.1, 0.25, 1.0, f.blue ? 4.6 : 0.5);
    for (const sx of [-0.6, 0.6]) { P.set(sx, 0.66, -2.4).applyMatrix4(g.matrix); glows.add(P.x, P.y, P.z, 0.85, 0.88, 1.0, 1.0); }
    for (const sx of [-0.65, 0.65]) { P.set(sx, 0.8, 2.45).applyMatrix4(g.matrix); glows.add(P.x, P.y, P.z, 1.0, 0.08, 0.05, 0.6); }
    addRefl(p.x, p.z + 1.5, 6, 13, f.red * 0.9, 0.02, f.blue * 1.0 + 0.02);
    addRefl(p.x, p.z - 10, 3.6, 13, 0.25, 0.26, 0.3);
  });
  glows.end(); refl.count = ri; refl.instanceMatrix.needsUpdate = true; if (refl.instanceColor) refl.instanceColor.needsUpdate = true;
  glowMat.uniforms.uScale.value = xrMode !== 'desktop' ? 700 : renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

  // trails
  const tp = trailGeo.attributes.position.array, tc = trailGeo.attributes.color.array;
  const camW = camera.position;
  for (let r = 0; r < 2; r++) {
    const sx = r ? 0.72 : -0.72;
    let prev = null;
    for (let i = 0; i < TRAIL_N; i++) {
      const h = sim.history(i * 0.0085); if (!h) break;
      const cy = Math.cos(h.yaw), syw = Math.sin(h.yaw);
      const x = h.x + sx * cy + 2.52 * syw, z = -sx * syw + 2.52 * cy + (S.s - h.s), y = 0.78;
      const cur = new THREE.Vector3(x, y, z);
      const nxt = prev ? cur.clone().sub(prev) : new THREE.Vector3(0, 0, 1);
      const side = nxt.cross(new THREE.Vector3().subVectors(camW, cur)).normalize().multiplyScalar(0.05 * (1 - i / TRAIL_N * 0.4));
      const o = (r * TRAIL_N + i) * 6;
      tp[o] = x + side.x; tp[o + 1] = y + side.y; tp[o + 2] = z + side.z; tp[o + 3] = x - side.x; tp[o + 4] = y - side.y; tp[o + 5] = z - side.z;
      const a = Math.pow(1 - i / TRAIL_N, 1.6) * 1.3 * Math.min(1, 0.25 + i / 6);
      tc[o] = tc[o + 3] = a; tc[o + 1] = tc[o + 4] = a * 0.06; tc[o + 2] = tc[o + 5] = a * 0.04;
      prev = cur;
    }
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;

  // sparks
  const sp = sparkGeo.attributes.position.array, sc = sparkGeo.attributes.color.array; let n = 0;
  for (const s of S.sparks) {
    if (!s.alive) continue;
    const life = s.age / s.life, o = n * 6;
    sp[o] = s.x - s.vx * 0.016; sp[o + 1] = s.y - s.vy * 0.016; sp[o + 2] = s.z - s.vz * 0.016; sp[o + 3] = s.x; sp[o + 4] = s.y; sp[o + 5] = s.z;
    const k = 1 - life;
    sc[o] = 2.2 * k; sc[o + 1] = (1.4 - life) * k; sc[o + 2] = 0.5 * k * k; sc[o + 3] = 3 * k; sc[o + 4] = (1.8 - life) * k; sc[o + 5] = 0.9 * k * k;
    n++;
  }
  sparkGeo.setDrawRange(0, n * 2); sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;

  // camera (desktop / render); in XR the headset owns the camera and we move the rig instead
  if (xrMode === 'desktop') {
    rig.matrix.identity(); rig.matrixWorldNeedsUpdate = true;
    applyShot(camera, sh);
    if (look.yaw || look.pitch) { camera.rotateY(look.yaw); camera.rotateX(look.pitch); }
    if (!look.dragging) { look.yaw *= Math.pow(0.04, dt); look.pitch *= Math.pow(0.04, dt); }
    renderer.toneMappingExposure = 0.95 + sh.white * 0.9;
  } else placeRig(S);

  scene.updateMatrixWorld();
  // mirror and cluster only when someone can see them
  const inCar = hero.cockpit.visible;
  if (inCar) {
    hero.mirror.getWorldPosition(mirrorCam.position);
    const hq = hero.group.getWorldQuaternion(new THREE.Quaternion());
    mirrorCam.quaternion.copy(hq).multiply(Q.setFromAxisAngle(P.set(0, 1, 0), Math.PI));
    mirrorCam.position.add(P.set(0, 0.05, 0.2).applyQuaternion(hq));
    mirrorCam.rotateX(-0.03);
    mirrorCam.updateMatrixWorld();
    const xrOn = renderer.xr.enabled; renderer.xr.enabled = false;
    const old = renderer.getRenderTarget(); hero.group.visible = false; // the mirror sees the road, not our own wing
    renderer.setRenderTarget(hero.mirrorRT); renderer.render(scene, mirrorCam); renderer.setRenderTarget(old);
    hero.group.visible = true; renderer.xr.enabled = xrOn;
    hud.drawCluster(hero.cluster.canvas, S, t); hero.cluster.tex.needsUpdate = true;
    if (xrMode !== 'desktop' && Math.floor(t * 10) !== Math.floor((t - dt) * 10)) drawXRPanel(S, t);
  }
  if (xrMode === 'desktop') hud.draw({ t, S, cam: camera, shot: sh, hero: hero.group, police: police.map((p) => p.group), hist: sim.history, mirror: hero.mirror });
}

// ---------------------------------------------------------------- XR: seat the viewer
function placeRig(S) {
  if (!xrSeat) { const xc = renderer.xr.getCamera(); xrSeat = xc.position.clone(); if (xrSeat.lengthSq() < 1e-6) xrSeat.set(0, 1.2, 0); }
  const car = heroMatrix(S, new THREE.Matrix4(), 0);
  let anchor;
  if (xrMode === 'ar') { // a table-top diorama in your room
    const s = 0.018;
    rig.matrix.compose(P.set(0, 0.8, -1.1), Q.identity(), SC.set(s, s, s));
    rig.matrix.multiply(new THREE.Matrix4().makeTranslation(-S.hero.x, 0, -8));
  } else {
    anchor = xrView === 'cockpit' ? EYE.clone() : new THREE.Vector3(0, 9, 24);
    const seat = car.clone().multiply(new THREE.Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z));
    if (xrView !== 'cockpit') seat.copy(new THREE.Matrix4().makeTranslation(S.hero.x * 0.7 + anchor.x, anchor.y, anchor.z));
    rig.matrix.makeTranslation(xrSeat.x, xrSeat.y, xrSeat.z).multiply(seat.invert());
  }
  rig.matrixWorldNeedsUpdate = true;
}
function drawXRPanel(S, t) {
  const x = xrPanelCanvas.getContext('2d'), w = xrPanelCanvas.width, h = xrPanelCanvas.height;
  x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(3,10,18,0.86)'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#62e6ff'; x.lineWidth = 3; x.strokeRect(2, 2, w - 4, h - 4);
  x.fillStyle = '#62e6ff'; x.font = '700 28px Bahnschrift, "Segoe UI", sans-serif'; x.fillText('AI COPILOT', 24, 46);
  const m = hud.copilotText(t, S);
  x.fillStyle = '#f4f8ff'; x.font = '700 30px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const s = m ? m.s : '추격 회피 중'; x.fillText(s.length > 22 ? s.slice(0, 22) : s, 24, 100); if (s.length > 22) x.fillText(s.slice(22), 24, 140);
  x.fillStyle = '#f2b45a'; x.font = '700 84px Bahnschrift, "Segoe UI", sans-serif'; x.fillText(S.kmh.toFixed(0), 24, 260);
  x.font = '600 26px Bahnschrift, sans-serif'; x.fillText('KM/H', 210, 260);
  x.fillStyle = '#ff4d5e'; x.fillText(`PURSUIT-1  ${(S.police[0].z - 4.8).toFixed(1)} m ${S.police[0].closing ? '▲ CLOSING' : ''}`, 24, 320);
  x.fillStyle = 'rgba(235,226,210,0.7)'; x.font = '500 22px "Malgun Gothic", sans-serif'; x.fillText('트리거 / 핀치 = 드론 시점 ↔ 운전석', 24, 372);
  xrPanelTex.needsUpdate = true;
}
app.onModeChange((mode) => {
  xrMode = mode; xrSeat = null; xrT0 = clock;
  for (const o of world.vrOnly) o.visible = mode !== 'ar';
  world.rain.visible = mode !== 'ar';
  scene.fog = mode === 'ar' ? null : new THREE.FogExp2(FOG, FOG_DENSITY);
  xrPanel.visible = mode !== 'desktop';
  if (mode === 'desktop') { rig.matrix.identity(); renderer.toneMappingExposure = 0.95; camera.fov = 50; camera.updateProjectionMatrix(); }
});
app.onSelectNothing(({ source }) => { if (source === 'xr') { xrView = xrView === 'cockpit' ? 'drone' : 'cockpit'; chime(app.audio, xrView === 'cockpit' ? 660 : 880, { gain: 0.08, time: 0.6 }); } });

// ---------------------------------------------------------------- desktop: drag to look, click a car
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY, look.yaw, look.pitch]; look.dragging = true; });
addEventListener('pointermove', (e) => { if (!down) return; look.yaw = down[2] - (e.clientX - down[0]) * 0.004; look.pitch = THREE.MathUtils.clamp(down[3] - (e.clientY - down[1]) * 0.004, -0.8, 0.8); });
addEventListener('pointerup', () => { down = null; look.dragging = false; });
for (const target of [hero.group, ...police.map((p) => p.group)]) app.interactive(target, () => chime(app.audio, target === hero.group ? 988 : 523, { gain: 0.12, time: 1.2 }));

// ---------------------------------------------------------------- sound: the same soundtrack the video uses
let track = null, src = null, srcStart = 0, srcOffset = 0;
app.onAudio(async (ctx) => {
  try { const buf = await (await fetch('audio/chase.wav')).arrayBuffer(); track = await ctx.decodeAudioData(buf); playFrom(appT); } catch (e) { console.warn('sound', e.message); }
  hint?.remove();
});
function playFrom(t) {
  const ctx = app.audio; if (!ctx || !track) return;
  try { src?.stop(); } catch {}
  src = ctx.createBufferSource(); src.buffer = track; src.loop = xrMode !== 'desktop'; src.connect(ctx.destination);
  srcOffset = t % track.duration; srcStart = ctx.currentTime; src.start(0, srcOffset);
}

// ---------------------------------------------------------------- loops
let clock = 0, appT = START_T;
const hint = RENDER ? null : document.getElementById('hint');
if (RENDER) {
  renderer.setAnimationLoop(null);
  const out = document.createElement('canvas'); out.width = renderer.domElement.width; out.height = renderer.domElement.height;
  const octx = out.getContext('2d');
  // accumulate > 0 blends sub-frames into the same picture (a little motion blur); the HUD goes on top, sharp
  window.__renderAt = (t, { quality = 0.93, accumulate = 0, of = 1 } = {}) => {
    update(t, 1 / 30);
    renderer.render(scene, camera);
    octx.globalAlpha = 1 / (accumulate + 1);
    octx.drawImage(renderer.domElement, 0, 0, out.width, out.height);
    octx.globalAlpha = 1;
    app.state.ready = true; app.state.calls = renderer.info.render.calls; app.state.triangles = renderer.info.render.triangles;
    if (accumulate < of - 1) return '';
    octx.drawImage(hudCanvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', quality);
  };
  window.__info = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, gl: renderer.getContext().getParameter(renderer.getContext().VERSION), collisions: sim.state.collisions, traffic: sim.state.traffic.length });
  update(START_T, 1 / 30); renderer.render(scene, camera);
  window.__ready = true;
} else {
  app.onFrame((dt) => {
    clock += dt;
    if (xrMode === 'desktop') {
      const before = appT;
      appT = appT + dt;
      if (appT >= T.end) { appT = 0; playFrom(0); }
      update(appT, dt);
      if (appT < before) playFrom(appT);
    } else update(16 + (clock - xrT0), dt);
  });
  window.__ready = true;
}

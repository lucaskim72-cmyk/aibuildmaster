// connect-xr.js: the small XR helper every connect-ai-xr template uses. CONNECT AI LAB, MIT + Commons Clause (see LICENSE).
// One call gives you a three.js scene that opens on Meta Quest (AR with passthrough on Quest 3/3S, VR on Quest 2),
// on an Android phone (AR), and falls back to a normal 3D view with mouse / touch on any computer or iPhone.
//
//   import { createXRApp } from 'connect-xr';
//   const app = await createXRApp({ title: 'My room', prefer: 'vr' });
//   app.scene.add(mesh); app.interactive(mesh, () => ...); app.onFrame((dt, t) => ...);
//
// Order of fallbacks: immersive-ar -> immersive-vr -> desktop orbit view (mouse) / phone (touch).
// Only local files are loaded (three.js is in ./vendor/three). Nothing is fetched from the internet.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

export { THREE };

const GOLD = '#D6892A', GOLD_HI = '#F2B45A', IVORY = '#EBE2D2';

const CSS = `
.cxr-bar{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;gap:10px;z-index:20;font:500 14px/1 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase}
.cxr-btn{padding:15px 26px;border-radius:999px;border:1px solid ${GOLD};background:rgba(10,8,6,.62);color:${IVORY};backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;transition:background .25s,color .25s}
.cxr-btn:hover{background:${GOLD};color:#0b0906}
.cxr-btn.main{background:${GOLD};color:#0b0906;font-weight:700}
.cxr-btn.main:hover{background:${GOLD_HI}}
.cxr-btn[disabled]{opacity:.45;cursor:default}
.cxr-brand{position:fixed;left:26px;top:22px;z-index:20;color:${IVORY};font:400 11px/1.6 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;letter-spacing:.32em;text-transform:uppercase;pointer-events:none}
.cxr-brand b{display:block;font:400 26px/1.15 "Didot","Bodoni 72","Cormorant Garamond",Georgia,serif;letter-spacing:.02em;text-transform:none;margin-top:6px}
.cxr-brand i{display:block;width:44px;height:1px;background:${GOLD};margin-top:10px}
.cxr-note{position:fixed;right:22px;top:24px;z-index:20;max-width:300px;color:rgba(235,226,210,.72);font:400 12px/1.5 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;text-align:right;pointer-events:none}
@media (max-width:640px){.cxr-note{display:none}.cxr-brand b{font-size:20px}.cxr-bar{bottom:18px}}
`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

// What this browser can do. Never throws: an old browser simply gets the desktop view.
export async function detectXR() {
  const out = { xr: !!navigator.xr, ar: false, vr: false, secure: window.isSecureContext !== false, touch: matchMedia('(pointer: coarse)').matches };
  if (!navigator.xr) return out;
  try { out.ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch {}
  try { out.vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch {}
  return out;
}

/**
 * @param {object} o
 * @param {string} o.title             shown top left and on the panel
 * @param {string} [o.subtitle]
 * @param {'ar'|'vr'} [o.prefer]       which button is the big one when both work (default 'vr')
 * @param {boolean} [o.hitTest]        AR: ask for hit-test and show a gold ring where a tap / pinch would place things
 * @param {boolean} [o.depth]          AR: ask for depth-sensing so real things hide virtual ones (Quest 3/3S)
 * @param {number[]} [o.cameraPos]     desktop camera start
 * @param {number[]} [o.target]        desktop orbit target
 * @param {boolean} [o.environment]    soft studio reflections (one small PMREM, cheap)
 * @param {string|number|null} [o.background]  VR / desktop background colour (AR is always passthrough)
 */
export async function createXRApp(o = {}) {
  const opts = { title: 'AI BUILD MASTER', subtitle: '', prefer: 'vr', hitTest: false, depth: true, cameraPos: [0, 1.6, 3], target: [0, 1.2, 0], environment: true, background: 0x0b0906, ...o };
  document.head.appendChild(el('style', null, CSS));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const bg = opts.background == null ? null : new THREE.Color(opts.background);
  scene.background = bg;
  if (opts.environment) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = typeof opts.environment === 'number' ? opts.environment : 0.35;
    pmrem.dispose();
  }

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.03, 200);
  camera.position.fromArray(opts.cameraPos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.fromArray(opts.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 25;
  controls.update();

  const support = await detectXR();
  const state = { mode: 'desktop', support, ready: false, fps: 0, calls: 0, triangles: 0, placed: 0, errors: [] };
  window.__xr = state; // read by `connect-ai-xr check`

  // ---------- things you can point at ----------
  const targets = [];
  const handlers = new Map();
  function interactive(obj, onSelect, onHover) {
    targets.push(obj);
    handlers.set(obj, { onSelect, onHover });
    return obj;
  }
  function findHandler(o3) {
    for (let p = o3; p; p = p.parent) if (handlers.has(p)) return { obj: p, h: handlers.get(p) };
    return null;
  }
  const shown = (o3) => { for (let p = o3; p; p = p.parent) if (p.visible === false) return false; return true; };
  const ray = new THREE.Raycaster();
  function hitFrom(origin, dir) {
    ray.set(origin, dir);
    ray.far = 30;
    const hits = ray.intersectObjects(targets, true);
    for (const h of hits) { const f = findHandler(h.object); if (f && shown(h.object)) return { ...f, point: h.point, distance: h.distance }; }
    return null;
  }

  // ---------- sound: only after a click / pinch (browsers block it before) ----------
  let audioCtx = null;
  const audioWaiters = [];
  function unlockAudio() {
    if (!audioCtx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      audioCtx = new C();
      audioWaiters.splice(0).forEach((f) => { try { f(audioCtx); } catch (e) { console.warn(e); } });
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  const onAudio = (f) => (audioCtx ? f(audioCtx) : audioWaiters.push(f));
  addEventListener('pointerdown', unlockAudio, { passive: true });
  addEventListener('keydown', unlockAudio);

  // ---------- desktop / phone: click or tap ----------
  let down = null;
  const ndc = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = hitFrom(ray.ray.origin, ray.ray.direction);
    if (hit) hit.h.onSelect?.({ point: hit.point, object: hit.obj, source: 'pointer' });
    else selectMiss.forEach((f) => f({ ray: ray.ray.clone(), source: 'pointer' }));
  });
  let hovered = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (renderer.xr.isPresenting || e.pointerType !== 'mouse') return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = hitFrom(ray.ray.origin, ray.ray.direction);
    const now = hit ? hit.obj : null;
    if (now !== hovered && hovered) handlers.get(hovered)?.onHover?.(false);
    if (now) hit.h.onHover?.(true, hit.point);
    hovered = now;
    renderer.domElement.style.cursor = now ? 'pointer' : '';
  });

  // ---------- headset: controllers and hands ----------
  const selectMiss = [];
  const placeFns = [];
  const handFactory = new XRHandModelFactory();
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const lineMat = new THREE.LineBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.8 });
  const controllers = [];
  const tmpM = new THREE.Matrix4(), tmpO = new THREE.Vector3(), tmpD = new THREE.Vector3();
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(lineGeo, lineMat);
    line.scale.z = 4;
    line.visible = false;
    c.add(line);
    c.userData.line = line;
    c.addEventListener('connected', (e) => { c.userData.source = e.data; line.visible = e.data.targetRayMode === 'tracked-pointer' || !!e.data.hand; });
    c.addEventListener('disconnected', () => { line.visible = false; c.userData.source = null; });
    c.addEventListener('select', () => {
      unlockAudio();
      tmpM.identity().extractRotation(c.matrixWorld);
      tmpO.setFromMatrixPosition(c.matrixWorld);
      tmpD.set(0, 0, -1).applyMatrix4(tmpM);
      const hit = hitFrom(tmpO, tmpD);
      if (hit) { hit.h.onSelect?.({ point: hit.point, object: hit.obj, source: 'xr', controller: c }); return; }
      if (reticle.visible && placeFns.length) { state.placed++; placeFns.forEach((f) => f(reticle.matrix.clone(), { controller: c })); return; }
      selectMiss.forEach((f) => f({ ray: new THREE.Ray(tmpO.clone(), tmpD.clone()), source: 'xr', controller: c }));
    });
    scene.add(c);
    controllers.push(c);
    const grip = renderer.xr.getControllerGrip(i);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.11, 12), new THREE.MeshStandardMaterial({ color: 0x1a1612, metalness: 0.6, roughness: 0.35 }));
    body.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 8, 24), new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.25 }));
    ring.position.z = -0.06;
    grip.add(body, ring);
    grip.addEventListener('connected', (e) => { grip.visible = !e.data.hand; });
    scene.add(grip);
    const hand = renderer.xr.getHand(i);
    hand.add(handFactory.createHandModel(hand, 'spheres')); // spheres: drawn in code, no download
    scene.add(hand);
  }

  // ---------- AR: gold ring where you can place things (hit-test) ----------
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GOLD_HI }));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  let hitSource = null;

  // ---------- buttons ----------
  const brand = el('div', 'cxr-brand', `${opts.subtitle || ""}<b>${opts.title}</b><i></i>`);
  const note = el('div', 'cxr-note');
  const bar = el('div', 'cxr-bar');
  document.body.append(brand, note, bar);
  const modeFns = [];

  async function enter(mode) {
    unlockAudio();
    const init = { requiredFeatures: [], optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] };
    if (mode === 'immersive-ar') {
      init.optionalFeatures.push('dom-overlay', 'anchors', 'plane-detection');
      if (opts.hitTest) init.optionalFeatures.push('hit-test');
      if (opts.depth) { init.optionalFeatures.push('depth-sensing'); init.depthSensing = { usagePreference: ['gpu-optimized'], dataFormatPreference: [] }; }
      init.domOverlay = { root: document.body };
    }
    let session;
    try { session = await navigator.xr.requestSession(mode, init); }
    catch (e) {
      // some browsers refuse the depth dictionary or an unknown feature: try again with the basics
      try { session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking', ...(mode === 'immersive-ar' && opts.hitTest ? ['hit-test'] : [])] }); }
      catch (e2) { note.textContent = 'Could not start ' + mode + ': ' + e2.message; state.errors.push(String(e2.message)); return; }
    }
    session.addEventListener('end', onEnd);
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(1);
    state.mode = mode === 'immersive-ar' ? 'ar' : 'vr';
    scene.background = state.mode === 'ar' ? null : bg;
    bar.style.display = 'none';
    if (state.mode === 'ar' && opts.hitTest) {
      try {
        const viewer = await session.requestReferenceSpace('viewer');
        hitSource = await session.requestHitTestSource({ space: viewer });
      } catch { hitSource = null; }
    }
    modeFns.forEach((f) => f(state.mode));
  }
  function onEnd() {
    hitSource = null;
    reticle.visible = false;
    state.mode = 'desktop';
    scene.background = bg;
    bar.style.display = '';
    modeFns.forEach((f) => f(state.mode));
  }

  const want = opts.prefer === 'ar' ? ['ar', 'vr'] : ['vr', 'ar'];
  const list = want.filter((m) => support[m]);
  for (const m of list) {
    const b = el('button', 'cxr-btn' + (m === list[0] ? ' main' : ''), m === 'ar' ? 'Enter AR' : 'Enter VR');
    b.onclick = () => enter(m === 'ar' ? 'immersive-ar' : 'immersive-vr');
    bar.appendChild(b);
  }
  if (!list.length) {
    const why = !support.secure ? 'XR needs HTTPS. Open the https:// address that connect-ai-xr demo prints.'
      : support.touch ? 'Drag to look around, pinch to zoom, tap to use.' : 'Drag to look around, scroll to zoom, click to use. On a Quest, open this page in the Meta Quest Browser.';
    note.textContent = why;
    const b = el('button', 'cxr-btn', support.touch ? '3D view · touch' : '3D view · mouse');
    b.disabled = true;
    bar.appendChild(b);
  } else {
    note.textContent = support.ar ? 'This headset can see your room. AR puts things on your real desk.' : 'Put on the headset and press Enter VR.';
  }

  // ---------- loop ----------
  const frameFns = [];
  const timer = new THREE.Timer();
  let frames = 0, acc = 0;
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop((t, frame) => {
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 0.1);
    const time = timer.getElapsed();
    if (!renderer.xr.isPresenting) controls.update();
    if (frame && hitSource) {
      const ref = renderer.xr.getReferenceSpace();
      const hits = frame.getHitTestResults(hitSource);
      if (hits.length) { reticle.visible = true; reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix); }
      else reticle.visible = false;
    }
    if (renderer.xr.isPresenting) {
      for (const c of controllers) {
        if (!c.userData.line.visible) continue;
        tmpM.identity().extractRotation(c.matrixWorld);
        tmpO.setFromMatrixPosition(c.matrixWorld);
        tmpD.set(0, 0, -1).applyMatrix4(tmpM);
        const hit = hitFrom(tmpO, tmpD);
        c.userData.line.scale.z = hit ? hit.distance : 4;
        const now = hit ? hit.obj : null;
        if (now !== c.userData.hover && c.userData.hover) handlers.get(c.userData.hover)?.onHover?.(false);
        if (now) hit.h.onHover?.(true, hit.point);
        c.userData.hover = now;
      }
    }
    for (const f of frameFns) f(dt, time, frame);
    renderer.render(scene, camera);
    frames++; acc += dt;
    if (acc >= 1) { state.fps = Math.round(frames / acc); frames = 0; acc = 0; }
    state.calls = renderer.info.render.calls;
    state.triangles = renderer.info.render.triangles;
    state.ready = true;
  });

  return {
    THREE, scene, camera, renderer, controls, state, support, reticle, controllers,
    interactive,
    onFrame: (f) => frameFns.push(f),
    onModeChange: (f) => modeFns.push(f),
    onPlace: (f) => placeFns.push(f),       // AR: called with the ring's matrix when you tap / pinch on a real surface
    onSelectNothing: (f) => selectMiss.push(f),
    onAudio,                                // f(audioContext) runs once sound is allowed
    get audio() { return audioCtx; },
    setNote: (t) => { note.textContent = t; },
    colors: { GOLD, GOLD_HI, IVORY },
  };
}

// ---------- small helpers the templates share ----------

// A glass panel made from a canvas: crisp text and buttons that work with mouse, touch, controller ray and pinch.
// buttons: [{ id, label, x, y, w, h }] in canvas pixels; draw(ctx, w, h) paints the face.
export function glassPanel(app, { width = 0.9, height = 0.5, px = 1024, draw, buttons = [], onButton } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = Math.round(px * height / width);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const group = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.04, height * 1.06), new THREE.MeshBasicMaterial({ color: 0x0b0906, transparent: true, opacity: 0.74, toneMapped: false }));
  glass.position.z = -0.004;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  group.add(glass, face);
  let hover = null;
  function paint() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    draw?.(ctx, canvas.width, canvas.height, { hover });
    ctx.restore(); ctx.save();
    for (const b of buttons) {
      const on = hover === b.id || b.active;
      ctx.fillStyle = on ? GOLD : 'rgba(235,226,210,0.06)';
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
      roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = on ? '#0b0906' : IVORY;
      ctx.font = `600 ${Math.round(b.h * 0.36)}px ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    }
    ctx.restore();
    tex.needsUpdate = true;
  }
  const uv = (point) => {
    const p = face.worldToLocal(point.clone());
    return [(p.x / width + 0.5) * canvas.width, (0.5 - p.y / height) * canvas.height];
  };
  const pick = ([x, y]) => buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  app.interactive(face, ({ point }) => { const b = pick(uv(point)); if (b) { onButton?.(b.id, b); paint(); } }, (on, point) => {
    const id = on && point ? pick(uv(point))?.id ?? null : null;
    if (id !== hover) { hover = id; paint(); }
  });
  paint();
  return { group, canvas, ctx, paint, buttons, setHover: (id) => { hover = id; paint(); } };
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Wood made in code (no image files): warm planks with grain, as a CanvasTexture.
export function woodTexture({ size = 512, tone = [118, 74, 42], planks = 6, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const rnd = mulberry(7);
  const ph = size / planks;
  for (let p = 0; p < planks; p++) {
    const k = 0.82 + rnd() * 0.3;
    g.fillStyle = `rgb(${tone[0] * k | 0},${tone[1] * k | 0},${tone[2] * k | 0})`;
    g.fillRect(0, p * ph, size, ph);
    for (let l = 0; l < 26; l++) {
      const y = p * ph + rnd() * ph, a = 0.04 + rnd() * 0.08;
      g.strokeStyle = rnd() > 0.5 ? `rgba(40,22,10,${a})` : `rgba(255,220,170,${a * 0.6})`;
      g.lineWidth = 0.6 + rnd() * 1.6;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) g.lineTo(x, y + Math.sin(x * 0.01 + l) * 2.2 + (rnd() - 0.5));
      g.stroke();
    }
    g.fillStyle = 'rgba(20,10,4,0.55)'; g.fillRect(0, p * ph, size, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

// A text label as a sprite-like plane (canvas). Good for names; keep it short.
export function label(text, { size = 0.08, color = IVORY, font = '"Didot","Bodoni 72",Georgia,serif', weight = 400 } = {}) {
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  const fpx = 96; g.font = `${weight} ${fpx}px ${font}`;
  const w = Math.ceil(g.measureText(text).width) + 40; c.width = w; c.height = fpx + 40;
  g.font = `${weight} ${fpx}px ${font}`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 20, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * w / c.height, size), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  return m;
}

// A soft chime made in code: sine + overtone with a slow fade. Needs app.audio (after a click / pinch).
export function chime(ctx, freq = 440, { gain = 0.18, time = 2.2, dest } = {}) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const out = ctx.createGain(); out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(gain, now + 0.02); out.gain.exponentialRampToValueAtTime(0.0001, now + time);
  out.connect(dest || ctx.destination);
  for (const [mul, g] of [[1, 1], [2.01, 0.35], [3.98, 0.12]]) {
    const o = ctx.createOscillator(); const og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq * mul; og.gain.value = g;
    o.connect(og).connect(out); o.start(now); o.stop(now + time + 0.1);
  }
}

export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Cars drawn in code: the hero supercar (with a full cockpit), two police cars, and instanced traffic.
import { THREE } from 'connect-xr';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// side profile (z forward-negative, y up) extruded across the width, with tumblehome (narrower at the top)
function profileBody(points, width, { bevel = 0.08, taper = 0.22, taperFrom = 0.55, taperTo = 1.3 } = {}) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 6 });
  g.rotateY(-Math.PI / 2); // shape x -> car z, extrusion -> -x
  g.translate((width - bevel * 2) / 2, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = 1 - taper * THREE.MathUtils.smoothstep(y, taperFrom, taperTo);
    p.setX(i, p.getX(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
function beam(a, b, t = 0.05, d = t) { // a box from point a to point b
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(t, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

// The driver's eye in hero-car coordinates (shared with the camera director and XR seat)
export const EYE = new THREE.Vector3(-0.12, 1.0, 0.45);
export const MIRROR = new THREE.Vector3(0.0, 1.13, -0.2);

export function buildHero(env) {
  const g = new THREE.Group(); g.name = 'hero';
  const paint = new THREE.MeshStandardMaterial({ color: 0xd8932f, metalness: 0.78, roughness: 0.2, envMap: env, envMapIntensity: 2.4, emissive: 0x1a0e04 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.5, roughness: 0.42, envMap: env, envMapIntensity: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x05070b, metalness: 0.95, roughness: 0.06, envMap: env, envMapIntensity: 1.6, transparent: true, opacity: 0.9 });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.15, 0.1), toneMapped: false });
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 3.6), toneMapped: false });

  const body = new THREE.Mesh(profileBody([[-2.36, 0.3], [-2.32, 0.5], [-1.7, 0.66], [-0.85, 0.82], [0.2, 0.86], [1.4, 0.88], [2.28, 0.93], [2.4, 0.86], [2.42, 0.42], [2.25, 0.2], [-2.2, 0.17]], 1.98), paint);
  const canopy = new THREE.Mesh(profileBody([[-0.86, 0.8], [-0.12, 1.25], [0.55, 1.24], [1.5, 0.97], [1.62, 0.84], [-0.86, 0.8]], 1.44, { bevel: 0.06, taper: 0.42, taperFrom: 0.82, taperTo: 1.25 }), glass);
  canopy.name = 'canopy';
  // carbon parts merged: splitter, side intakes, diffuser, rear wing + struts, mirrors
  const carbonGeo = mergeGeometries([
    box(2.0, 0.05, 0.5, 0, 0.2, -2.2), box(0.06, 0.26, 1.1, 1.0, 0.5, 0.65), box(0.06, 0.26, 1.1, -1.0, 0.5, 0.65),
    box(1.7, 0.16, 0.3, 0, 0.3, 2.42), box(1.92, 0.04, 0.38, 0, 1.18, 2.12), beam([0.55, 0.9, 2.1], [0.5, 1.17, 2.12], 0.05, 0.12), beam([-0.55, 0.9, 2.1], [-0.5, 1.17, 2.12], 0.05, 0.12),
    box(0.04, 0.14, 0.42, 0.96, 1.08, 2.12), box(0.04, 0.14, 0.42, -0.96, 1.08, 2.12),
    box(0.18, 0.07, 0.12, 1.02, 0.92, -0.62), box(0.18, 0.07, 0.12, -1.02, 0.92, -0.62),
    ...[0, 1, 2, 3, 4, 5].map((i) => box(1.05 - i * 0.05, 0.025, 0.05, 0, 0.975 - i * 0.008, 1.66 + i * 0.1)), // engine-cover louvres
  ]);
  const carbonMesh = new THREE.Mesh(carbonGeo, carbon);
  const tailMesh = new THREE.Mesh(mergeGeometries([box(1.7, 0.05, 0.04, 0, 0.8, 2.52), box(0.34, 0.11, 0.04, 0.74, 0.73, 2.515), box(0.34, 0.11, 0.04, -0.74, 0.73, 2.515), box(0.12, 0.08, 0.06, 0.3, 0.32, 2.58), box(0.12, 0.08, 0.06, -0.3, 0.32, 2.58)]), tail);
  const headMesh = new THREE.Mesh(mergeGeometries([beam([0.42, 0.62, -2.28], [0.88, 0.69, -2.0], 0.04, 0.06), beam([-0.42, 0.62, -2.28], [-0.88, 0.69, -2.0], 0.04, 0.06)]), head);
  // from the driver's seat the full body would cover the cabin floor, so the cockpit view swaps it for the hood alone
  const hood = new THREE.Mesh(profileBody([[-2.36, 0.3], [-2.32, 0.5], [-1.7, 0.66], [-0.85, 0.82], [-0.62, 0.83], [-0.62, 0.3]], 1.98), paint);
  hood.visible = false;
  g.add(body, hood, canopy, carbonMesh, tailMesh, headMesh);

  // wheels: tyre + gold-black rim, spun by the caller
  const wheels = [];
  const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 28).rotateZ(Math.PI / 2);
  const rimGeo = mergeGeometries([new THREE.CylinderGeometry(0.25, 0.25, 0.33, 20).rotateZ(Math.PI / 2), ...[0, 1, 2, 3, 4].map((i) => box(0.335, 0.05, 0.44).rotateX((i * Math.PI) / 5))]);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.75 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1b1714, metalness: 0.9, roughness: 0.3, envMap: env });
  for (const [x, z] of [[0.88, -1.45], [-0.88, -1.45], [0.9, 1.45], [-0.9, 1.45]]) {
    const w = new THREE.Group(); w.position.set(x, 0.36, z);
    w.add(new THREE.Mesh(tyreGeo, tyreMat), new THREE.Mesh(rimGeo, rimMat));
    g.add(w); wheels.push(w);
  }

  // ---------- cockpit (seen in the first-person part and in VR) ----------
  const cockpit = new THREE.Group(); cockpit.name = 'cockpit';
  const trim = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.5, metalness: 0.4, envMap: env, envMapIntensity: 0.9, emissive: 0x0a0d13 });
  const alcantara = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.92, emissive: 0x0b0d12 });
  const goldTrim = new THREE.MeshStandardMaterial({ color: 0xd6892a, metalness: 0.9, roughness: 0.3, envMap: env });
  const pillarL = [[-0.6, 0.8, -0.8], [-0.47, 1.25, -0.12]], pillarR = [[0.6, 0.8, -0.8], [0.47, 1.25, -0.12]];
  const shell = mergeGeometries([
    beam(...pillarL, 0.075, 0.09), beam(...pillarR, 0.075, 0.09), // A-pillars
    beam([-0.5, 1.262, -0.1], [0.5, 1.262, -0.1], 0.013, 0.018),    // windshield header (thin: it sits right above the eyes)
    beam([-0.47, 1.25, -0.12], [-0.4, 1.24, 0.75], 0.05, 0.06), beam([0.47, 1.25, -0.12], [0.4, 1.24, 0.75], 0.05, 0.06), // glass-roof rails
    box(0.86, 0.05, 0.06, 0, 1.235, 0.78),                          // rear roof header
    box(1.7, 0.2, 0.5, 0, 0.7, -0.6),                               // dash body
    box(1.6, 0.04, 0.24, 0, 0.8, -0.38),                            // dash top lip
    box(0.3, 0.12, 0.16, -0.12, 0.86, -0.47),                        // instrument binnacle
    box(0.06, 0.5, 1.6, -0.82, 0.62, 0.1), box(0.06, 0.5, 1.6, 0.82, 0.62, 0.1), // door cards
    box(0.3, 0.12, 0.9, 0.18, 0.55, 0.15),                          // centre tunnel
  ]);
  cockpit.add(new THREE.Mesh(shell, alcantara));
  cockpit.add(new THREE.Mesh(mergeGeometries([box(1.5, 0.012, 0.012, 0, 0.822, -0.26), box(0.012, 0.3, 0.012, -0.79, 0.86, -0.3), box(0.012, 0.3, 0.012, 0.79, 0.86, -0.3)]), goldTrim));
  // ambient LED lines (dash edge, roof edges, doors): the cabin glows a little cyan, like the HUD
  cockpit.add(new THREE.Mesh(mergeGeometries([box(1.46, 0.006, 0.006, 0, 0.806, -0.345), box(0.006, 0.006, 0.9, -0.54, 1.245, 0.4), box(0.006, 0.006, 0.9, 0.54, 1.245, 0.4), box(0.006, 0.006, 1.2, -0.785, 0.86, 0.2), box(0.006, 0.006, 1.2, 0.785, 0.86, 0.2)]), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.8, 2.4), toneMapped: false })));

  // windshield glass: rain drops + a soft white glow the ending turns up
  const windTex = rainDropsTexture();
  const windGeo = new THREE.BufferGeometry();
  const wv = new Float32Array([-0.6, 0.8, -0.8, 0.6, 0.8, -0.8, 0.47, 1.25, -0.12, -0.47, 1.25, -0.12]);
  windGeo.setAttribute('position', new THREE.BufferAttribute(wv, 3));
  windGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  windGeo.setIndex([0, 1, 2, 0, 2, 3]); windGeo.computeVertexNormals();
  const windMat = new THREE.MeshBasicMaterial({ map: windTex, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, color: 0xffffff, toneMapped: false });
  const windshield = new THREE.Mesh(windGeo, windMat); windshield.renderOrder = 5;
  cockpit.add(windshield);

  // racing wheel (flat-bottomed rim, three spokes, gold top marker): rotates about its own axis
  const wheel = new THREE.Group();
  wheel.position.set(EYE.x, 0.745, -0.06);
  wheel.rotation.x = -0.44; // face the driver
  const wheelSpin = new THREE.Group(); wheel.add(wheelSpin);
  const rim = new THREE.TorusGeometry(0.158, 0.017, 10, 40);
  const pos = rim.attributes.position; for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.13) pos.setY(i, -0.13 + (pos.getY(i) + 0.13) * 0.2);
  rim.computeVertexNormals();
  wheelSpin.add(new THREE.Mesh(mergeGeometries([rim, box(0.3, 0.035, 0.02, 0, 0, 0), box(0.035, 0.13, 0.02, 0, -0.07, 0), new THREE.CylinderGeometry(0.055, 0.06, 0.05, 20).rotateX(Math.PI / 2)]), trim));
  wheelSpin.add(new THREE.Mesh(mergeGeometries([box(0.04, 0.012, 0.055, 0.13, 0.0, -0.01), box(0.04, 0.012, 0.055, -0.13, 0.0, -0.01)]), goldTrim)); // shift paddles
  wheelSpin.add(new THREE.Mesh(box(0.012, 0.016, 0.038, 0, 0.158, 0.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.52, 0.14), toneMapped: false }))); // 12 o'clock marker
  cockpit.add(wheel);

  // digital cluster (canvas, redrawn each frame by the HUD) and the rear-view mirror (render target)
  const clusterCanvas = document.createElement('canvas'); clusterCanvas.width = 640; clusterCanvas.height = 240;
  const clusterTex = new THREE.CanvasTexture(clusterCanvas); clusterTex.colorSpace = THREE.SRGBColorSpace;
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.094), new THREE.MeshBasicMaterial({ map: clusterTex, toneMapped: false }));
  cluster.position.set(EYE.x, 0.9, -0.37); cluster.rotation.x = -0.26;
  cockpit.add(cluster);
  const mirrorRT = new THREE.WebGLRenderTarget(512, 148, { samples: 2 });
  mirrorRT.texture.colorSpace = THREE.SRGBColorSpace;
  const mirrorMat = new THREE.MeshBasicMaterial({ map: mirrorRT.texture, toneMapped: false });
  mirrorRT.texture.wrapS = THREE.RepeatWrapping; mirrorRT.texture.repeat.x = -1; // a mirror is flipped left-right
  const mirror = new THREE.Group(); mirror.position.copy(MIRROR);
  mirror.lookAt(EYE.clone().add(new THREE.Vector3(0.12, 0, 0)));
  mirror.add(new THREE.Mesh(box(0.25, 0.08, 0.025, 0, 0, -0.014), trim));
  mirror.add(new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.066), mirrorMat));
  mirror.add(new THREE.Mesh(box(0.02, 0.06, 0.02, 0, 0.07, -0.03), trim));
  cockpit.add(mirror);
  g.add(cockpit);

  return { group: g, body, hood, canopy, wheels, cockpit, wheel: wheelSpin, windshield, windMat, cluster: { canvas: clusterCanvas, tex: clusterTex, mesh: cluster }, mirror, mirrorRT, paint };
}

function rainDropsTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  let a = 99; const R = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  for (let i = 0; i < 420; i++) {
    const px = R() * 512, py = R() * 512, r = 1 + R() * R() * 5.5;
    const gr = x.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.55, 'rgba(170,200,255,0.16)'); gr.addColorStop(1, 'rgba(120,150,200,0)');
    x.fillStyle = gr; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    if (R() < 0.12) { x.strokeStyle = 'rgba(200,220,255,0.12)'; x.lineWidth = r * 0.6; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 8, py + 18 + R() * 40); x.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildPolice(env, idx) {
  const g = new THREE.Group(); g.name = 'police' + idx;
  const black = new THREE.MeshStandardMaterial({ color: 0x0a0b0e, metalness: 0.7, roughness: 0.3, envMap: env, envMapIntensity: 1.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.4, roughness: 0.35, envMap: env, envMapIntensity: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x06080c, metalness: 0.9, roughness: 0.08, envMap: env, envMapIntensity: 1.4 });
  const body = profileBody([[-2.45, 0.34], [-2.4, 0.66], [-1.5, 0.84], [-0.7, 0.9], [1.6, 0.94], [2.4, 0.96], [2.46, 0.42], [2.3, 0.22], [-2.3, 0.22]], 1.9, { taper: 0.1 });
  const cabin = profileBody([[-0.75, 0.88], [-0.1, 1.38], [1.05, 1.38], [1.7, 0.93], [-0.75, 0.88]], 1.62, { bevel: 0.05, taper: 0.18, taperFrom: 0.9, taperTo: 1.38 });
  g.add(new THREE.Mesh(body, black), new THREE.Mesh(cabin, glass));
  g.add(new THREE.Mesh(mergeGeometries([box(0.03, 0.32, 2.3, 0.955, 0.6, 0.15), box(0.03, 0.32, 2.3, -0.955, 0.6, 0.15), box(1.2, 0.03, 1.0, 0, 1.395, 0.45)]), white));
  // light bar: left red, right blue; materials are flashed by the caller
  const red = new THREE.MeshBasicMaterial({ color: 0x330000, toneMapped: false });
  const blue = new THREE.MeshBasicMaterial({ color: 0x000833, toneMapped: false });
  const barBase = new THREE.Mesh(box(1.2, 0.06, 0.28, 0, 1.42, 0.2), black);
  const r = new THREE.Mesh(box(0.55, 0.09, 0.24, -0.3, 1.49, 0.2), red), b = new THREE.Mesh(box(0.55, 0.09, 0.24, 0.3, 1.49, 0.2), blue);
  g.add(barBase, r, b);
  g.add(new THREE.Mesh(mergeGeometries([box(0.4, 0.07, 0.04, 0.6, 0.66, -2.42), box(0.4, 0.07, 0.04, -0.6, 0.66, -2.42)]), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.1, 3.4), toneMapped: false })));
  g.add(new THREE.Mesh(mergeGeometries([box(0.35, 0.08, 0.04, 0.65, 0.8, 2.47), box(0.35, 0.08, 0.04, -0.65, 0.8, 2.47)]), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.08), toneMapped: false })));
  const wheelGeo = mergeGeometries([[0.84, -1.5], [-0.84, -1.5], [0.84, 1.5], [-0.84, 1.5]].map(([x, z]) => new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18).rotateZ(Math.PI / 2).translate(x, 0.34, z)));
  g.add(new THREE.Mesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.8 })));
  return { group: g, red, blue };
}

// All traffic in a handful of draw calls. update(cars) writes the instance matrices.
export function buildTraffic(env, cars) {
  const cars0 = cars.filter((c) => c.kind !== 'truck'), trucks = cars.filter((c) => c.kind === 'truck');
  const bodyGeo = profileBody([[-2.3, 0.32], [-2.26, 0.62], [-1.4, 0.78], [-0.6, 0.84], [1.5, 0.88], [2.26, 0.9], [2.32, 0.38], [2.18, 0.2], [-2.18, 0.2]], 1.84, { taper: 0.1 });
  bodyGeo.scale(1, 1, 1);
  const cabGeo = profileBody([[-0.65, 0.82], [-0.05, 1.42], [0.95, 1.42], [1.6, 0.87], [-0.65, 0.82]], 1.6, { bevel: 0.05, taper: 0.16, taperFrom: 0.9, taperTo: 1.42 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.65, roughness: 0.32, envMap: env, envMapIntensity: 1.0 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x05070a, metalness: 0.9, roughness: 0.1, envMap: env, envMapIntensity: 1.2 });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.12, 0.08), toneMapped: false });
  const truckGeo = mergeGeometries([box(2.5, 3.0, 8.6, 0, 2.0, 1.4), box(2.3, 2.4, 2.4, 0, 1.6, -4.3)]);
  const truckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.55, envMap: env, envMapIntensity: 0.6 });
  const wheelGeo = mergeGeometries([[0.82, -1.45], [-0.82, -1.45], [0.82, 1.45], [-0.82, 1.45]].map(([x, z]) => new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2).translate(x, 0.33, z)));
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 });
  const tailGeo = mergeGeometries([box(0.38, 0.09, 0.05, 0.62, 0, 0), box(0.38, 0.09, 0.05, -0.62, 0, 0)]);

  const nC = Math.max(1, cars0.length), nT = Math.max(1, trucks.length), nAll = cars.length;
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, nC), cabs = new THREE.InstancedMesh(cabGeo, glassMat, nC), wheels = new THREE.InstancedMesh(wheelGeo, wheelMat, nC + nT);
  const truckM = new THREE.InstancedMesh(truckGeo, truckMat, nT), tails = new THREE.InstancedMesh(tailGeo, tailMat, nAll);
  const col = new THREE.Color();
  cars0.forEach((c, i) => bodies.setColorAt(i, col.setHex(c.paint)));
  trucks.forEach((c, i) => truckM.setColorAt(i, col.setHex([0xd9dde2, 0x9aa3ad, 0x4c5866, 0xb89a6a][i % 4])));
  for (const m of [bodies, cabs, wheels, truckM, tails]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
  const group = new THREE.Group(); group.add(bodies, cabs, wheels, truckM, tails);
  const M = new THREE.Matrix4(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), P = new THREE.Vector3();
  function update(list) {
    let ci = 0, ti = 0, wi = 0, li = 0;
    for (const c of list) {
      const bob = Math.sin(c.z * 0.3 + c.lane) * 0.01;
      if (c.kind === 'truck') {
        M.makeTranslation(c.x, bob, c.z); truckM.setMatrixAt(ti++, M);
        M.makeTranslation(c.x, bob, c.z - 3.6); wheels.setMatrixAt(wi++, M);
        M.compose(P.set(c.x, 0.75, c.z + 5.76), Q.identity(), S.set(1.3, 1.4, 1)); tails.setMatrixAt(li++, M);
      } else {
        const sc = c.kind === 'van' ? 1.12 : 1;
        M.compose(P.set(c.x, bob, c.z), Q.identity(), S.set(sc, c.kind === 'van' ? 1.35 : 1, sc)); bodies.setMatrixAt(ci, M); cabs.setMatrixAt(ci++, M);
        M.compose(P.set(c.x, 0, c.z), Q.identity(), S.set(1, 1, sc)); wheels.setMatrixAt(wi++, M);
        M.compose(P.set(c.x, 0.78 * (c.kind === 'van' ? 1.3 : 1), c.z + 2.3 * sc + 0.03), Q.identity(), S.set(sc, 1, 1)); tails.setMatrixAt(li++, M);
      }
    }
    bodies.count = cabs.count = ci; truckM.count = ti; wheels.count = wi; tails.count = li;
    for (const m of [bodies, cabs, wheels, truckM, tails]) m.instanceMatrix.needsUpdate = true;
  }
  return { group, update };
}

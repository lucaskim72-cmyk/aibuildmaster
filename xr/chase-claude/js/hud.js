// JARVIS-style HUD drawn on a 2D canvas over the 3D view. Every bracket is the real 3D box of a car,
// projected through the camera each frame. Layout is designed on a 1080 x 1920 (9:16) frame and scales to any window.
import { THREE } from 'connect-xr';
import { heroKmh, nearestObstacle, LANES, LANE_W, ROAD_HALF } from './sim.js';

const CY = '#62e6ff', CY_D = 'rgba(98,230,255,', GOLD = '#f2b45a', GOLD_D = 'rgba(242,180,90,', RED = '#ff4d5e', RED_D = 'rgba(255,77,94,', ORANGE = '#ff9b3d', IVORY = '#ebe2d2';
const F_UI = 'Bahnschrift, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const F_KO = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');

// shorts hooks (the exact times asked for)
const HOOKS = [
  { a: 0.0, b: 3.9, lines: [[['AI 코드 ', '#fff'], ['100%', GOLD]]] },
  { a: 8.0, b: 12.0, lines: [[['잠시 후 ', '#fff'], ['운전석', GOLD], [' 진입', '#fff']]] },
  { a: 16.0, b: 20.0, lines: [[['1인칭 ', '#fff'], ['320km/h', GOLD]]] },
  { a: 21.6, b: 25.9, tag: '반전', lines: [[['영상이 아니라', '#fff']], [['직접 열리는 ', '#fff'], ['3D 앱', GOLD]]] },
];

export function createHUD(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, k = 1, DW = 1080, DH = 1920;
  // layout: tall (shorts 9:16) or wide (desktop). y values in design units
  let LY = { tall: true, hook: 300, copilot: 548, radarY: 1320, telY: 1360, top: 190, upHi: 536, lo: 648, hi: 1308 };
  function resize(w, h, dpr = 1) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    W = canvas.width; H = canvas.height;
    k = Math.min(W / 1080, H / 1100);
    DW = W / k; DH = H / k;
    LY = DH >= 1500
      ? { tall: true, hook: 300, copilot: 548, radarY: DH - 600, telY: DH - 560, top: 190, upHi: 536, lo: 648, hi: DH - 612 }
      : { tall: false, hook: 150, copilot: 236, radarY: DH - 330, telY: DH - 300, top: 330, upHi: 330, lo: 336, hi: DH - 40 };
  }
  const V = new THREE.Vector3();
  function project(p, cam) { V.copy(p).project(cam); if (V.z > 1 || V.z < -1) return null; return [(V.x * 0.5 + 0.5) * DW, (-V.y * 0.5 + 0.5) * DH]; }
  function boxOnScreen(center, half, M, cam) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? half.x : -half.x, i & 2 ? half.y : -half.y, i & 4 ? half.z : -half.z).add(center);
      if (M) p.applyMatrix4(M);
      const s = project(p, cam); if (!s) return null;
      x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[0]); y1 = Math.max(y1, s[1]);
    }
    if (x1 < -50 || x0 > DW + 50 || y1 < -50 || y0 > DH + 50) return null;
    return { x0, y0, x1, y1 };
  }
  const glow = (c, b = 14) => { ctx.shadowColor = c; ctx.shadowBlur = b; };
  const noGlow = () => { ctx.shadowBlur = 0; };
  function bracket(r, color, a = 1, padPx = 10) {
    const x0 = r.x0 - padPx, y0 = r.y0 - padPx, x1 = r.x1 + padPx, y1 = r.y1 + padPx;
    const L = clamp(Math.min(x1 - x0, y1 - y0) * 0.28, 10, 46);
    ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = 3; glow(color);
    ctx.beginPath();
    ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
    ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
    ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
    ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
    ctx.stroke();
    // centre tick
    ctx.lineWidth = 1.5; ctx.globalAlpha = a * 0.6;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
    noGlow(); ctx.globalAlpha = 1;
    return { x0, y0, x1, y1 };
  }
  // label box with a leader line from the bracket corner. side: 1 = right, -1 = left
  function tag(r, side, up, color, lines, a = 1) {
    const ax = side > 0 ? r.x1 : r.x0, ay = up ? r.y0 : r.y1;
    const fs = 25, lh = 31;
    ctx.font = `600 ${fs}px ${F_UI}`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l.t).width)) + 30, h = lines.length * lh + 16;
    let bx = ax + side * 70, by = ay + (up ? -58 - h : 58);
    bx = side > 0 ? clamp(bx, 20, DW - w - 20) : clamp(bx - w, 20, DW - w - 20);
    // keep labels out of the copilot bar and the bottom panels: above the bar for things high on screen, below it otherwise
    by = LY.tall && ay < 600 && !hookOn ? clamp(by, LY.top, LY.upHi - h) : clamp(by, LY.lo, Math.max(LY.lo, LY.hi - h));
    const ex = side > 0 ? bx : bx + w, ey = by + (up ? h : 0);
    ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = 2; glow(color, 8);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex - side * 26, ey); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.arc(ax, ay, 4, 0, 7); ctx.fillStyle = color; ctx.fill();
    noGlow();
    ctx.fillStyle = 'rgba(4,10,18,0.62)'; ctx.fillRect(bx, by, w, h);
    ctx.strokeStyle = color; ctx.globalAlpha = a * 0.75; ctx.lineWidth = 1.5; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(side > 0 ? bx : bx + w - 5, by, 5, h);
    lines.forEach((l, i) => {
      ctx.font = `${l.b ? 700 : 600} ${l.s || fs}px ${F_UI}`;
      ctx.fillStyle = l.c || IVORY; ctx.textBaseline = 'top';
      ctx.fillText(l.t, bx + 16, by + 9 + i * lh);
    });
    ctx.globalAlpha = 1;
  }

  // ---------- panels ----------
  function panel(x, y, w, h, title, sub) {
    ctx.fillStyle = 'rgba(3,9,16,0.6)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = CY_D + '0.55)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.strokeStyle = CY; ctx.lineWidth = 3; glow(CY, 8);
    ctx.beginPath(); ctx.moveTo(x, y + 18); ctx.lineTo(x, y); ctx.lineTo(x + 18, y); ctx.moveTo(x + w - 18, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - 18); ctx.stroke(); noGlow();
    ctx.font = `700 19px ${F_UI}`; ctx.fillStyle = CY; ctx.textBaseline = 'top'; ctx.fillText(title, x + 14, y + 10);
    if (sub) { ctx.font = `500 16px ${F_UI}`; ctx.fillStyle = CY_D + '0.7)'; const tw = ctx.measureText(sub).width; ctx.fillText(sub, x + w - tw - 12, y + 12); }
  }

  function radar(S, t, x, y, w, h) {
    panel(x, y, w, h, 'LIDAR · 6-LANE', 'R 140m');
    const ix = x + 16, iy = y + 40, iw = w - 32, ih = h - 54;
    const Z0 = -140, Z1 = 40;
    const mx = (xm) => ix + ((xm + ROAD_HALF + 1) / (ROAD_HALF * 2 + 2)) * iw;
    const mz = (zm) => iy + ((zm - Z0) / (Z1 - Z0)) * ih;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
    // lanes (dashes scroll with distance)
    for (let l = 0; l <= LANES; l++) {
      const lx = mx(-ROAD_HALF + l * LANE_W);
      ctx.strokeStyle = l === 0 || l === LANES ? CY_D + '0.6)' : CY_D + '0.22)'; ctx.lineWidth = l === 0 || l === LANES ? 2 : 1.2;
      ctx.setLineDash(l === 0 || l === LANES ? [] : [10, 10]); ctx.lineDashOffset = -(S.s * 2.2) % 20;
      ctx.beginPath(); ctx.moveTo(lx, iy); ctx.lineTo(lx, iy + ih); ctx.stroke();
    }
    ctx.setLineDash([]);
    // sweep
    const hx = mx(S.hero.x), hz = mz(0);
    const ang = (t * 2.6) % (Math.PI * 2);
    for (let i = 0; i < 14; i++) {
      const a0 = ang - i * 0.05;
      ctx.fillStyle = CY_D + (0.12 * (1 - i / 14)).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(hx, hz); ctx.arc(hx, hz, iw * 1.4, a0 - 0.05, a0); ctx.closePath(); ctx.fill();
    }
    for (const rr of [40, 80, 120]) { ctx.strokeStyle = CY_D + '0.16)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx, hz, (rr / (Z1 - Z0)) * ih, Math.PI, Math.PI * 2); ctx.stroke(); }
    const obs = nearestObstacle(S);
    for (const c of S.traffic) {
      if (c.z < Z0 - 10 || c.z > Z1 + 10) continue;
      const isObs = obs && obs.car === c;
      ctx.fillStyle = isObs ? ORANGE : 'rgba(235,226,210,0.8)';
      if (isObs) glow(ORANGE, 10);
      const cw = (c.w / (ROAD_HALF * 2 + 2)) * iw, cl = (c.len / (Z1 - Z0)) * ih;
      ctx.fillRect(mx(c.x) - cw / 2, mz(c.z) - cl / 2, cw, Math.max(3, cl)); noGlow();
    }
    S.police.forEach((p, i) => {
      const on = Math.floor(t * 8 + i) % 2 === 0;
      ctx.fillStyle = on ? RED : '#4d8bff'; glow(ctx.fillStyle, 12);
      ctx.fillRect(mx(p.x) - 5, mz(p.z) - 8, 10, 16); noGlow();
    });
    ctx.fillStyle = GOLD; glow(GOLD, 14);
    ctx.beginPath(); ctx.moveTo(hx, hz - 13); ctx.lineTo(hx + 8, hz + 9); ctx.lineTo(hx - 8, hz + 9); ctx.closePath(); ctx.fill(); noGlow();
    ctx.restore();
    ctx.font = `600 16px ${F_UI}`; ctx.fillStyle = CY_D + '0.8)'; ctx.textBaseline = 'bottom';
    ctx.fillText(`TRK ${S.traffic.filter((c) => c.z > Z0 && c.z < Z1).length}  ·  PURSUIT 2`, x + 14, y + h - 6);
  }

  function telemetry(S, hist, t, x, y, w, h) {
    panel(x, y, w, h, 'TELEMETRY', 'LIVE 120Hz');
    const rows = [
      { name: 'SPD', unit: 'KM/H', get: (s) => heroKmh(s.t), min: 280, max: 345, col: GOLD, fmt: (v) => v.toFixed(0) },
      { name: 'DRIFT', unit: '°', get: (s) => -s.yaw * 57.3, min: -14, max: 14, col: CY, fmt: (v) => v.toFixed(1) },
      { name: 'LAT-G', unit: 'G', get: (s) => s.ax / 9.81, min: -2.6, max: 2.6, col: '#9effc8', fmt: (v) => v.toFixed(2) },
    ];
    const rh = (h - 50) / rows.length;
    rows.forEach((r, i) => {
      const ry = y + 42 + i * rh, gx = x + 112, gw = w - 128, gh = rh - 12;
      ctx.strokeStyle = 'rgba(98,230,255,0.12)'; ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) { ctx.beginPath(); ctx.moveTo(gx, ry + (gh * g) / 4); ctx.lineTo(gx + gw, ry + (gh * g) / 4); ctx.stroke(); }
      const N = 90; ctx.beginPath();
      let last = 0;
      for (let j = 0; j < N; j++) {
        const hs = hist(((N - 1 - j) / (N - 1)) * 2.8); if (!hs) continue;
        const v = r.get(hs); if (j === N - 1) last = v;
        const px = gx + (j / (N - 1)) * gw, py = ry + gh - clamp((v - r.min) / (r.max - r.min), 0, 1) * gh;
        j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.strokeStyle = r.col; ctx.lineWidth = 2.4; glow(r.col, 8); ctx.stroke(); noGlow();
      ctx.font = `600 15px ${F_UI}`; ctx.fillStyle = r.col; ctx.textBaseline = 'top'; ctx.fillText(r.name, x + 14, ry);
      ctx.font = `700 28px ${F_UI}`; ctx.fillStyle = IVORY; ctx.fillText(r.fmt(last), x + 14, ry + 18);
      ctx.font = `500 13px ${F_UI}`; ctx.fillStyle = 'rgba(235,226,210,0.6)'; ctx.fillText(r.unit, x + 14 + ctx.measureText(r.fmt(last)).width * 1.9 + 4, ry + 30);
    });
  }

  // ---------- AI COPILOT briefing (Korean, typed live) ----------
  function copilotText(t, S) {
    const tt = t > 30 ? 16 + ((t - 16) % 10.2) : t;
    const d0 = (S.police[0].z - 4.8).toFixed(0);
    const obs = nearestObstacle(S);
    const side = (S.hero.lane > (obs ? obs.car.lane : S.hero.lane)) ? '우측' : '좌측';
    const L = [
      [0.15, 4.0, `추격 감지 — 경찰차 2대 후방 ${d0}m 접근 중`],
      [4.0, 8.0, `${S.hero.lane + 1}차선 개방 확인 · 고속 회피 기동 실행`],
      [8.0, 13.0, `드론 링크 동기화 · 경로 예측 정확도 99.2%`],
      [13.0, 16.0, `운전석 시점으로 전환 — 시야 확장`],
      [16.0, 20.0, `${S.kmh.toFixed(0)}km/h 유지 · 전방 아치 통과, 노면 젖음 주의`],
      [20.0, 23.2, obs ? `전방 장애물 ${obs.dist.toFixed(0)}m — ${side} 차선으로 회피` : `전방 클리어 · 차선 유지`],
      [23.2, 26.2, `추격 차량 거리 ${d0}m · 탈출 경로 확보`],
    ];
    for (const [a, b, s] of L) if (tt >= a && tt < b) return { s, age: tt - a };
    return null;
  }
  function copilot(t, S, y) {
    const m = copilotText(t, S); if (!m) return;
    const w = Math.min(DW - 140, 1000), x = (DW - w) / 2, h = 84;
    const appear = sm(0, 0.25, m.age);
    ctx.globalAlpha = appear;
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, 'rgba(3,12,22,0.82)'); g.addColorStop(1, 'rgba(3,12,22,0.45)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = CY_D + '0.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // scan line
    const sx = x + ((t * 420) % w); const sg = ctx.createLinearGradient(sx - 90, 0, sx, 0); sg.addColorStop(0, 'rgba(98,230,255,0)'); sg.addColorStop(1, 'rgba(98,230,255,0.18)');
    ctx.fillStyle = sg; ctx.fillRect(Math.max(x, sx - 90), y, Math.min(90, sx - x), h);
    // tag
    ctx.fillStyle = CY; glow(CY, 12); ctx.fillRect(x, y, 8, h); noGlow();
    const pulse = 0.5 + 0.5 * Math.sin(t * 9);
    ctx.fillStyle = `rgba(98,230,255,${0.5 + pulse * 0.5})`; ctx.beginPath(); ctx.arc(x + 34, y + 30, 7, 0, 7); ctx.fill();
    ctx.font = `700 20px ${F_UI}`; ctx.fillStyle = CY; ctx.textBaseline = 'middle'; ctx.fillText('AI COPILOT', x + 50, y + 30);
    ctx.font = `500 15px ${F_UI}`; ctx.fillStyle = CY_D + '0.65)'; ctx.fillText(`LINK ${(12 + 3 * Math.sin(t * 3)).toFixed(0)}ms · CONF 0.99`, x + 26, y + 60);
    // the message types itself out
    const n = Math.floor(m.age * 34);
    const txt = m.s.slice(0, n);
    ctx.font = `700 33px ${F_KO}`; ctx.fillStyle = '#f4f8ff'; ctx.textBaseline = 'middle';
    const tx = x + 250; ctx.fillText(txt, tx, y + h / 2 + 1);
    if (n < m.s.length || Math.floor(t * 3) % 2 === 0) { const cw = ctx.measureText(txt).width; ctx.fillStyle = CY; ctx.fillRect(tx + cw + 6, y + 26, 14, 34); }
    ctx.globalAlpha = 1;
  }

  // ---------- shorts hook captions ----------
  function hooks(t) {
    for (const hk of HOOKS) {
      if (t < hk.a || t > hk.b) continue;
      const age = t - hk.a, left = hk.b - t;
      const a = sm(0, 0.18, age) * sm(0, 0.25, left);
      const pop = 1 + 0.14 * Math.exp(-age * 9) * Math.cos(age * 22) - 0.08 * (1 - sm(0, 0.12, age));
      const fs = hk.lines.length > 1 ? 82 : 96, lh = fs * 1.18;
      let y = LY.hook - ((hk.lines.length - 1) * lh) / 2;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(DW / 2, y); ctx.scale(pop, pop); ctx.translate(-DW / 2, -y);
      if (hk.tag) {
        ctx.font = `800 40px ${F_KO}`; const tw = ctx.measureText(hk.tag).width + 36;
        ctx.fillStyle = GOLD; ctx.fillRect(DW / 2 - tw / 2, y - lh / 2 - 64, tw, 54);
        ctx.fillStyle = '#0b0906'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(hk.tag, DW / 2, y - lh / 2 - 36);
      }
      for (const line of hk.lines) {
        ctx.font = `800 ${fs}px ${F_KO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const total = line.reduce((s, [txt]) => s + ctx.measureText(txt).width, 0);
        let x = DW / 2 - total / 2;
        for (const [txt, col] of line) {
          ctx.lineJoin = 'round'; ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(0,0,0,0.88)'; ctx.strokeText(txt, x, y);
          ctx.fillStyle = col; if (col !== '#fff') glow('rgba(242,180,90,0.8)', 22);
          ctx.fillText(txt, x, y); noGlow();
          x += ctx.measureText(txt).width;
        }
        y += lh;
      }
      ctx.restore();
    }
  }

  function frameDecor(t, phase, alt) {
    ctx.strokeStyle = CY_D + '0.5)'; ctx.lineWidth = 2;
    const m = 34, L = 56, top = LY.tall ? 150 : 40, bot = LY.tall ? DH - 250 : DH - 20;
    ctx.beginPath();
    ctx.moveTo(m, top + L); ctx.lineTo(m, top); ctx.lineTo(m + L, top);
    ctx.moveTo(DW - m - L, top); ctx.lineTo(DW - m, top); ctx.lineTo(DW - m, top + L);
    ctx.moveTo(m, bot - L); ctx.lineTo(m, bot); ctx.lineTo(m + L, bot);
    ctx.moveTo(DW - m - L, bot); ctx.lineTo(DW - m, bot); ctx.lineTo(DW - m, bot - L);
    ctx.stroke();
    ctx.font = `600 18px ${F_UI}`; ctx.textBaseline = 'top'; ctx.fillStyle = CY_D + '0.8)'; ctx.textAlign = 'left';
    ctx.fillText(phase === 'drone' ? `CAM  DRONE-07  ·  ALT ${alt.toFixed(1)}m` : phase === 'zoom' ? 'CAM  LINKING → COCKPIT' : 'CAM  COCKPIT  ·  DRIVER POV', m + 14, top + 12);
    ctx.textAlign = 'right';
    const rec = Math.floor(t * 2) % 2 === 0;
    ctx.fillStyle = rec ? RED : 'rgba(255,77,94,0.35)'; ctx.fillText(`● REC  T+${pad2(t)}.${pad2((t % 1) * 100)}`, DW - m - 14, top + 12);
    ctx.textAlign = 'left';
  }

  function warp(amount, t) {
    if (amount <= 0.01) return;
    const cx = DW / 2, cy = DH * 0.47;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    let a = 4242; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let i = 0; i < 170; i++) {
      const ang = r() * Math.PI * 2, sp = r(), ph = (t * (1.6 + sp * 2.4) + r()) % 1;
      const r0 = 60 + ph * ph * DH * 0.9, len = (40 + 380 * amount) * (0.4 + ph);
      ctx.strokeStyle = `rgba(${200 + r() * 55 | 0},${235 + r() * 20 | 0},255,${(0.55 * amount * (1 - ph * 0.6)).toFixed(3)})`;
      ctx.lineWidth = 1 + r() * 2.2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len)); ctx.stroke();
    }
    ctx.restore();
    const v = ctx.createRadialGradient(cx, cy, DH * 0.15, cx, cy, DH * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,6,14,${0.55 * amount})`);
    ctx.fillStyle = v; ctx.fillRect(0, 0, DW, DH);
  }

  function whiteout(white, logo, t) {
    if (white <= 0) return;
    const cx = DW / 2, cy = DH * 0.42;
    // light blooms out of the windshield, then fills everything
    const rad = DH * (0.05 + 1.15 * Math.pow(white, 1.15));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255,255,255,${Math.min(1, white * 3)})`); g.addColorStop(0.45, `rgba(252,253,255,${Math.min(1, white * 1.8)})`); g.addColorStop(1, `rgba(245,248,255,0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, DW, DH);
    ctx.fillStyle = `rgba(255,255,255,${sm(0.6, 1, white)})`; ctx.fillRect(0, 0, DW, DH);
    if (logo <= 0) return;
    // the logo: heavy, tight, near-black on white, with a thin gold rule
    const text = 'AI BUILD MASTER';
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fs = 150; ctx.font = `700 ${fs}px Bahnschrift, "Arial Black", "Segoe UI", sans-serif`;
    ctx.letterSpacing = '2px';
    let tw = ctx.measureText(text).width; fs *= Math.min(1, (DW * 0.86) / tw); ctx.font = `700 ${fs}px Bahnschrift, "Arial Black", "Segoe UI", sans-serif`;
    tw = ctx.measureText(text).width;
    const ly = DH * 0.48;
    const reveal = sm(0, 1, logo);
    ctx.beginPath(); ctx.rect(cx - (tw / 2 + 20) * reveal, ly - fs, (tw + 40) * reveal, fs * 2); ctx.clip();
    ctx.globalAlpha = sm(0, 0.6, logo);
    ctx.fillStyle = '#0d0f14';
    ctx.fillText(text, cx, ly + (1 - sm(0, 0.8, logo)) * 18);
    ctx.restore();
    const rw = 220 * sm(0.35, 1, logo);
    ctx.fillStyle = '#d6892a'; ctx.fillRect(cx - rw / 2, ly + fs * 0.62, rw, 7);
  }

  let hookOn = false;
  function draw(info) {
    const { t, S, cam, shot, hero, police, hist, xr } = info;
    hookOn = HOOKS.some((h) => t >= h.a - 0.1 && t <= h.b + 0.1);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const hudA = 1 - sm(0.0, 0.5, shot.white);
    if (hudA > 0.01) {
      ctx.globalAlpha = 1;
      ctx.save(); ctx.globalAlpha = hudA;
      // --- 3D brackets ---
      if (shot.phase === 'drone' || (shot.phase === 'zoom' && t < 14.4)) {
        const r = boxOnScreen(new THREE.Vector3(0, 0.62, 0), new THREE.Vector3(1.0, 0.62, 2.4), hero.matrixWorld, cam);
        if (r) {
          const b = bracket(r, GOLD, hudA);
          tag(b, 1, true, GOLD, [{ t: 'AI-01  ·  TARGET LOCK', c: GOLD, s: 19, b: true }, { t: `${S.kmh.toFixed(0)} KM/H`, b: true, s: 30 }, { t: `DRIFT ${Math.abs(S.hero.yaw * 57.3).toFixed(1)}°`, c: '#ffd9a0' }], hudA);
        }
        police.forEach((pg, i) => {
          const p = S.police[i];
          const r2 = boxOnScreen(new THREE.Vector3(0, 0.78, 0), new THREE.Vector3(0.95, 0.78, 2.45), pg.matrixWorld, cam); if (!r2) return;
          const blink = p.closing && Math.floor(t * 6) % 2 === 0;
          const b = bracket(r2, RED, hudA);
          tag(b, i === 0 ? -1 : 1, false, RED, [{ t: `PURSUIT-${i + 1}`, c: RED, s: 19, b: true }, { t: `${(p.z - 4.8).toFixed(1)} m`, b: true, s: 30 }, { t: p.closing ? '▲ CLOSING' : '· TRACKING', c: blink ? '#fff' : RED }], hudA);
        });
      }
      if (shot.phase !== 'zoom' || t > 15.4) {
        const o = nearestObstacle(S);
        if (o) {
          const c = o.car;
          const r3 = boxOnScreen(new THREE.Vector3(c.x, c.h / 2, c.z), new THREE.Vector3(c.w / 2, c.h / 2, c.len / 2), null, cam);
          if (r3 && r3.x1 - r3.x0 > 6) {
            const near = o.dist < 95, blink = near && Math.floor(t * 7) % 2 === 0;
            const b = bracket(r3, ORANGE, hudA, 8);
            tag(b, c.x > S.hero.x ? 1 : -1, true, ORANGE, [{ t: 'OBSTACLE', c: ORANGE, s: 19, b: true }, { t: `${o.dist.toFixed(0)} m`, b: true, s: 30 }, { t: near ? (c.x > S.hero.x ? '◀ EVADE' : 'EVADE ▶') : 'MONITOR', c: blink ? '#fff' : ORANGE }], hudA);
          }
        }
        // faint ID ticks on other traffic close ahead
        for (const c of S.traffic) {
          if (o && o.car === c) continue;
          if (c.z > 5 || c.z < -110) continue;
          const s = project(new THREE.Vector3(c.x, c.h + 0.4, c.z), cam); if (!s) continue;
          ctx.globalAlpha = hudA * 0.55; ctx.strokeStyle = CY; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(s[0] - 9, s[1] - 9); ctx.lineTo(s[0], s[1]); ctx.lineTo(s[0] + 9, s[1] - 9); ctx.stroke();
          ctx.font = `600 14px ${F_UI}`; ctx.fillStyle = CY; ctx.textAlign = 'center'; ctx.fillText(`V-${String(c.id).padStart(2, '0')} ${(-c.z).toFixed(0)}m`, s[0], s[1] - 22); ctx.textAlign = 'left';
          ctx.globalAlpha = hudA;
        }
      }
      // rear-view mirror call-out in the cockpit
      if ((shot.phase === 'pov' || shot.phase === 'white') && info.mirror) {
        const ms = project(info.mirror.getWorldPosition(new THREE.Vector3()), cam);
        const p = S.police[0];
        if (ms) {
          const r = { x0: ms[0] - 150, y0: ms[1] - 40, x1: ms[0] + 150, y1: ms[1] + 40 };
          ctx.globalAlpha = hudA;
          tag({ x0: r.x1, y0: r.y1, x1: r.x1, y1: r.y1 }, 1, false, RED, [{ t: 'REAR · PURSUIT-1', c: RED, s: 18, b: true }, { t: `${(p.z - 4.8).toFixed(1)} m ${p.closing ? '▲ CLOSING' : ''}`, b: true, s: 26 }], hudA);
        }
      }
      frameDecor(t, shot.phase, cam.position.y);
      copilot(t, S, LY.copilot);
      radar(S, t, DW - 345, LY.radarY, 310, 300);
      telemetry(S, hist, t, 36, LY.telY, 380, 260);
      warp(shot.warp || 0, t);
      ctx.restore();
    }
    hooks(t);
    whiteout(shot.white, shot.logo, t);
  }

  // the in-car digital cluster (canvas on the dashboard)
  function drawCluster(c, S, t) {
    const x = c.getContext('2d'), w = c.width, h = c.height;
    x.fillStyle = '#020407'; x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(98,230,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    // rpm bar
    const rpm = 0.72 + 0.2 * Math.sin(t * 2.1) + 0.06 * Math.sin(t * 7.7);
    for (let i = 0; i < 30; i++) {
      const on = i / 30 < rpm;
      x.fillStyle = on ? (i > 25 ? '#ff4d5e' : i > 20 ? '#f2b45a' : '#62e6ff') : 'rgba(98,230,255,0.12)';
      x.fillRect(30 + i * 19.4, 22 + (i > 20 ? 0 : 4), 14, i > 20 ? 22 : 18);
    }
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.font = `700 118px ${F_UI}`; x.fillStyle = '#f4f8ff'; x.shadowColor = '#62e6ff'; x.shadowBlur = 16;
    x.fillText(S.kmh.toFixed(0), w / 2, 178); x.shadowBlur = 0;
    x.font = `600 24px ${F_UI}`; x.fillStyle = '#62e6ff'; x.fillText('KM/H', w / 2, 212);
    x.textAlign = 'left'; x.font = `700 76px ${F_UI}`; x.fillStyle = '#f2b45a'; x.fillText('7', 34, 170);
    x.font = `600 20px ${F_UI}`; x.fillStyle = 'rgba(242,180,90,0.8)'; x.fillText('GEAR', 34, 200);
    x.textAlign = 'right'; x.font = `700 22px ${F_UI}`; x.fillStyle = '#62e6ff'; x.fillText('AI PILOT', w - 30, 96);
    x.fillStyle = Math.floor(t * 4) % 2 ? '#ff4d5e' : 'rgba(255,77,94,0.4)'; x.fillText('PURSUIT ×2', w - 30, 128);
    x.fillStyle = 'rgba(235,226,210,0.75)'; x.font = `600 20px ${F_UI}`; x.fillText(`DRIFT ${Math.abs(S.hero.yaw * 57.3).toFixed(1)}°`, w - 30, 160);
    x.fillText(`REAR ${(S.police[0].z - 4.8).toFixed(1)}m`, w - 30, 190);
  }

  return { resize, draw, drawCluster, copilotText, get scale() { return k; } };
}

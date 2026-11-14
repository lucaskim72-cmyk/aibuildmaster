// 토리 실험실 소리: 학습 음악 (브라우저 안에서 직접 연주하는 칩튠, 파일 없음) + Kore 목소리 (sound/*.mp3)
// 켜기/끄기는 음악 · 목소리 따로, 브라우저에 기억 (localStorage, 실패해도 기본 = 켬)

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* 저장 안 돼도 괜찮음 */ } },
};

let ctx = null, master = null, musicBus = null, voiceBus = null;
function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.0; musicBus.connect(master);
    voiceBus = ctx.createGain(); voiceBus.gain.value = 1.0; voiceBus.connect(master);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export const sound = { music: store.get("tori.music", true), voice: store.get("tori.voice", true) };

// ---------- 음악: 귀엽고 신나는 칩튠 (C 장조, 132 BPM, 8마디 반복) ----------
const BPM = 132, STEP = 60 / BPM / 4;            // 16분음표 한 칸
const MUSIC_VOL = 0.16;
const N = (s) => 440 * Math.pow(2, (s - 69) / 12);   // MIDI → Hz
// 화음: C  G  Am  F | C  G  F  G
const CHORDS = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50], [41, 45, 48], [43, 47, 50]];
// 멜로디 (16칸 × 8마디, 0 = 쉼)
const MEL = [
  [72, 0, 76, 0, 79, 0, 76, 0, 77, 0, 76, 74, 72, 0, 0, 0],
  [71, 0, 74, 0, 79, 0, 74, 0, 76, 0, 74, 72, 71, 0, 67, 0],
  [69, 0, 72, 0, 76, 0, 72, 0, 74, 72, 71, 72, 74, 0, 0, 0],
  [77, 0, 76, 0, 74, 0, 72, 0, 69, 0, 72, 0, 74, 0, 0, 0],
  [72, 0, 76, 0, 79, 0, 84, 0, 83, 0, 81, 79, 76, 0, 0, 0],
  [74, 0, 79, 0, 83, 0, 79, 0, 81, 79, 77, 76, 74, 0, 0, 0],
  [77, 0, 81, 0, 84, 0, 81, 0, 79, 0, 77, 0, 76, 0, 74, 0],
  [74, 0, 76, 0, 77, 0, 79, 0, 83, 0, 0, 0, 79, 0, 0, 0],
];
let playing = false, nextT = 0, step = 0, timer = null, noiseBuf = null;

function tone(t, freq, dur, type, vol, slide = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.02);
}
function noise(t, dur, vol, hp) {
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f); f.connect(g); g.connect(musicBus); s.start(t); s.stop(t + dur + 0.02);
}
function playStep(t, k) {
  const bar = Math.floor(k / 16) % 8, s = k % 16, ch = CHORDS[bar];
  const m = MEL[bar][s]; if (m) tone(t, N(m), STEP * 1.7, "square", 0.07);           // 멜로디 (네모파, 통통)
  tone(t, N(ch[s % 3] + 12), STEP * 0.9, "triangle", 0.045);                           // 아르페지오 (반짝반짝)
  if (s % 4 === 0) tone(t, N(ch[0] - 12), STEP * 3.2, "triangle", 0.16);              // 베이스
  if (s === 0 || s === 8) tone(t, 150, 0.12, "sine", 0.35, 0.3);                      // 킥 (퐁)
  if (s === 4 || s === 12) noise(t, 0.09, 0.12, 1500);                                 // 스네어 (착)
  if (s % 2 === 1) noise(t, 0.03, 0.05, 7000);                                         // 하이햇 (칙)
}
function scheduler() {
  while (nextT < ctx.currentTime + 0.12) { playStep(nextT, step); nextT += STEP; step++; }
}
function musicOn() {
  if (playing || !sound.music) return;
  ac(); playing = true; step = 0; nextT = ctx.currentTime + 0.06;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(0, ctx.currentTime); musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, ctx.currentTime + 0.8);
  timer = setInterval(scheduler, 30); scheduler();
}
function musicOff() {
  if (!playing) return; playing = false;
  const t = ctx.currentTime; musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(musicBus.gain.value, t); musicBus.gain.linearRampToValueAtTime(0, t + 0.5);
  setTimeout(() => { if (!playing) clearInterval(timer); }, 550);
}
let wantMusic = false;   // 학습 중이면 true (음악 버튼을 다시 켜면 이어서 나옴)
export function trainingMusic(on) { wantMusic = on; on ? musicOn() : musicOff(); }

// ---------- 목소리 (Kore) ----------
const VOICES = {
  start: ["start1", "start2"], win: ["win1", "win2", "win3"], crash: ["crash1", "crash2", "crash3"],
  out: ["out1", "out2"], tout: ["tout1", "tout2"], testgood: ["testgood"], testbad: ["testbad"],
};
const bufs = {}; let lastVoice = -9, lastName = "", loading = null, curSrc = null;
function loadVoices() {
  if (loading) return loading;
  ac();
  const names = [...new Set(Object.values(VOICES).flat())];
  loading = Promise.all(names.map(async n => {
    try { const r = await fetch(`./sound/${n}.mp3`); bufs[n] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* 없으면 조용히 */ }
  }));
  return loading;
}
// 첫 클릭 · 키 누름 때 소리 준비 (브라우저는 사용자가 한 번 누르기 전엔 소리를 막음 → 그동안 요청한 목소리가 쌓였다가 늦게 나오던 문제)
function unlock() { ac(); loadVoices(); }
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, unlock, { capture: true });
// 버튼 반응용: 파일 준비가 안 됐으면 (첫 클릭) 불러온 뒤 바로 말함
export function sayNow(kind) { ac(); return loadVoices().then(() => say(kind, true)); }
export function stopVoice() { if (curSrc) { try { curSrc.stop(); } catch { /* 이미 끝남 */ } curSrc = null; } }
// kind = start | win | crash | out | tout | testgood | testbad.  force = 쉬는 시간 무시 (버튼 반응 등)
// 돌려줌 = 지금 바로 말하기 시작한 목소리 길이 (초), 말 안 하면 0. 늦게 나올 바엔 건너뜀 (기다리지 않음).
export function say(kind, force = false) {
  if (!sound.voice || !VOICES[kind] || !ctx || ctx.state !== "running") return 0;
  const now = ctx.currentTime;
  if (!force && now - lastVoice < 1.0) return 0;             // 아주 짧은 사이 두 번 말하지 않게
  const pool = VOICES[kind].filter(n => bufs[n] && (VOICES[kind].length === 1 || n !== lastName));
  if (!pool.length) return 0;
  const n = pool[(Math.random() * pool.length) | 0], b = bufs[n];
  lastVoice = now; lastName = n;
  stopVoice();
  const s = ctx.createBufferSource(); s.buffer = b; s.connect(voiceBus); s.start(now);
  curSrc = s; s.onended = () => { if (curSrc === s) curSrc = null; };
  if (playing) {                                             // 말하는 동안 음악 살짝 줄이기
    const g = musicBus.gain; g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(MUSIC_VOL * 0.35, now + 0.08);
    g.setValueAtTime(MUSIC_VOL * 0.35, now + b.duration); g.linearRampToValueAtTime(MUSIC_VOL, now + b.duration + 0.4);
  }
  return b.duration;
}

// ---------- 켜기/끄기 버튼 ----------
export function bindSoundButtons(btnMusic, btnVoice) {
  const paint = () => {
    btnMusic.textContent = sound.music ? "🎵 음악 켬" : "🎵 음악 끔"; btnMusic.classList.toggle("off", !sound.music);
    btnVoice.textContent = sound.voice ? "🗣 목소리 켬" : "🗣 목소리 끔"; btnVoice.classList.toggle("off", !sound.voice);
  };
  btnMusic.onclick = () => { sound.music = !sound.music; store.set("tori.music", sound.music); if (!sound.music) musicOff(); else if (wantMusic) musicOn(); paint(); };
  btnVoice.onclick = () => { sound.voice = !sound.voice; store.set("tori.voice", sound.voice); paint(); if (sound.voice) loadVoices().then(() => say("win", true)); else stopVoice(); };
  paint();
}

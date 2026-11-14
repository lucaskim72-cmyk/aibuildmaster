// 학습 워커: 화면이 멈추지 않도록 PPO 를 따로 돌림
import { PPO } from "./nav_core.js";

let ppo = null, running = false, course = null, frac = 0.3, opts = {};

function make(brain = null) {
  ppo = new PPO({ ...opts, brain });
  if (course) ppo.env.setCourse(course, frac);
  postMessage({ type: "ready", it: ppo.it, hidden: ppo.hidden, nEnv: ppo.nEnv });
  sendWeights();
}
function sendWeights() {
  postMessage({ type: "weights", it: ppo.it, W: ppo.pi.W.map(w => w.slice()), b: ppo.pi.b.map(b => b.slice()), sizes: ppo.pi.sizes });
}
async function loop() {
  while (running) {
    const s = ppo.iterate();
    postMessage({ type: "stats", s });
    sendWeights();
    await new Promise(r => setTimeout(r, 0));   // 사이사이 메시지 받기
  }
}

onmessage = (e) => {
  const m = e.data;
  switch (m.cmd) {
    case "init": opts = m.opts || {}; make(m.brain || null); break;
    case "start": if (!running) { running = true; loop(); } break;
    case "pause": running = false; break;
    case "course": course = m.course; frac = m.frac; if (ppo) ppo.env.setCourse(course, frac); break;
    case "lr": opts.lr = m.lr; if (ppo) ppo.setLR(m.lr); break;
    case "cfg": opts = { ...opts, ...m.cfg, w: { ...(opts.w || {}), ...(m.cfg.w || {}) } }; if (ppo) ppo.setCfg(m.cfg); break;
    case "getBrain": postMessage({ type: "brain", brain: ppo.brainJSON(m.name) }); break;
  }
};

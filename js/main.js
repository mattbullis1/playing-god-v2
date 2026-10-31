import * as THREE from 'three';
import { LifeWorld } from './life.js';
import { Simulation, DISASTERS } from './sim.js';
import { World } from './world.js';

/* ------------------------------------------------------------------ boot */

const boot = document.getElementById('boot');
const canvas = document.getElementById('scene');
const stage = document.getElementById('stage');

const life = new LifeWorld(2400);
const sim = new Simulation(life, {});
let world;

try {
  world = new World(canvas, life, sim.effects);
  // Wire civilization to world for rendering
  world.civilization = sim.civilization;
} catch (err) {
  boot.querySelector('p').textContent = 'WEBGL UNAVAILABLE';
  boot.querySelector('small').textContent = 'This browser could not start the 3D engine.';
  throw err;
}

let lastVersion = -1;
world.setGlow(sim.params.glow / 100);

/* ------------------------------------------------------------------ dom */

const $ = (id) => document.getElementById(id);
const el = {
  statGen: $('stat-gen'),
  statSouls: $('stat-souls'),
  statBirths: $('stat-births'),
  statDeaths: $('stat-deaths'),
  statFps: $('stat-fps'),
  statEra: $('stat-era'),
  statAlignment: $('stat-alignment'),
  statWorship: $('stat-worship'),
  popValue: $('pop-value'),
  popRaw: $('pop-raw'),
  popDelta: $('pop-delta'),
  peak: $('peak-value'),
  lost: $('lost-value'),
  eventCount: $('event-count'),
  chart: $('chart'),
  logList: $('log-list'),
  logCount: $('log-count'),
  activeList: $('active-list'),
  activeCount: $('active-count'),
  toast: $('event-toast'),
  toastIcon: $('toast-icon'),
  toastTitle: $('toast-title'),
  toastDesc: $('toast-desc'),
  toastTag: $('toast-tag'),
  flash: $('fx-flash'),
  livePill: document.querySelector('.live-pill'),
  btnPause: $('btn-pause'),
  btnStep: $('btn-step'),
  btnReseed: $('btn-reseed'),
  btnClear: $('btn-clear'),
  btnBlessing: $('btn-blessing'),
  btnRain: $('btn-rain'),
  btnMeteor: $('btn-meteor'),
  civEraFill: $('civ-era-fill'),
  civEraMeta: $('civ-era-meta'),
  civWorshipFill: $('civ-worship-fill'),
  civWorshipMeta: $('civ-worship-meta'),
  civTemples: $('civ-temples'),
  civDefense: $('civ-defense'),
  civMoodFill: $('civ-mood-fill'),
  civMoodMeta: $('civ-mood-meta'),
  civMoodLabel: $('civ-mood-label'),
};

const M = 1_000_000;
let eventTotal = 0;
let toastTimer = 0;
let lastFrame = performance.now();
let fpsAvg = 60;
let uiAcc = 0;
let chartAcc = 0;
let lastUiPop = 0;
let lastUiPopTime = performance.now();

/* ------------------------------------------------------------------ format */

function compact(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function withCommas(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function duration(sec) {
  return sec >= 10 ? `${Math.round(sec)}s` : `${sec.toFixed(1)}s`;
}

/* ------------------------------------------------------------------ hooks */

const worldPos = (p) => new THREE.Vector3(p.x, p.y, p.z);

sim.hooks.event = (d) => {
  eventTotal++;
  addLog(d);
  showToast(d);
  flash(d.color);
  uiTick();
};

sim.hooks.ended = () => {
  uiTick();
};

sim.hooks.vfx = (kind, pos, sev) => {
  if (kind === 'quake') {
    world.quake(worldPos(pos), sev);
    flash('#ffd9a3');
  } else if (kind === 'war') {
    flash('#ff7a6b');
  }
};

function flash(color) {
  el.flash.style.background = color || '#d8fff6';
  el.flash.classList.remove('go');
  void el.flash.offsetWidth;
  el.flash.classList.add('go');
}

function showToast(d) {
  el.toast.style.setProperty('--c', d.color);
  el.toastIcon.innerHTML = `<svg><use href="#i-${d.type}"/></svg>`;
  el.toastTitle.textContent = d.name;
  el.toastDesc.textContent = d.desc;
  el.toastTag.textContent = d.manual ? 'DIVINE' : 'NATURAL';
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 4600);
}

function addLog(d) {
  el.logList.querySelector('.log-empty')?.remove();
  const li = document.createElement('li');
  li.className = 'log-item';
  li.style.setProperty('--c', d.color);
  li.innerHTML = `
    <i class="log-dot"></i>
    <span class="log-copy">
      <span class="log-name">${d.name}</span>
      <span class="log-desc">${d.desc}</span>
    </span>
    <span class="log-cas"><span>${compact(d.cas * M)}</span><small>LOST</small></span>`;
  d.logEl = li;
  d.logCas = li.querySelector('.log-cas span');
  el.logList.prepend(li);
  while (el.logList.children.length > 10) el.logList.lastElementChild.remove();
  el.logCount.textContent = `${eventTotal} EVENT${eventTotal === 1 ? '' : 'S'}`;
}

/* ------------------------------------------------------------------ ui */

const activeInfo = {
  earthquake: (d) => `AFTERSHOCKS · M${d.magnitude || '—'}`,
  plague: (d) => `CONTAGION · ${d.infected || 0} INFECTED`,
  wildfire: (d) => `BURN FRONT · ${Math.round(d.sev * 100)}%`,
  flood: (d) => `SEA LEVEL · ${Math.round((1 - (d.level || 1)) * 100)}%`,
  famine: (d) => `HARVEST FAILURE · ${Math.round(d.sev * 100)}%`,
  war: (d) => `FRONT LINE · ${d.sides ? d.sides[0].replace('The ', '') : ''}`,
};

function renderActive() {
  const list = sim.disasters;
  el.activeCount.textContent = String(list.length);
  if (!list.length) {
    el.activeList.innerHTML = '<p class="empty">No active disasters</p>';
    return;
  }
  el.activeList.innerHTML = list
    .map((d) => {
      const p = Math.max(0, Math.min(100, (d.t / d.dur) * 100));
      const left = Math.max(0, d.dur - d.t);
      return `
      <div class="active-item" style="--c:${d.color}">
        <div class="ai-top">
          <span class="ai-name">${d.name}</span>
          <span class="ai-time">${duration(left)}</span>
        </div>
        <div class="ai-sub">
          <span>${activeInfo[d.type] ? activeInfo[d.type](d) : ''}</span>
          <b>${compact(d.cas * M)} lost</b>
        </div>
        <div class="ai-bar" style="--p:${p}%"></div>
      </div>`;
    })
    .join('');
}

function setStageClass() {
  const fx = sim.effects;
  stage.classList.toggle('is-plague', fx.plague > 0);
  stage.classList.toggle('is-war', !!(fx.war && fx.war.active));
  stage.classList.toggle('is-flood', !!(fx.flood && (fx.flood.active || fx.flood.level < 0.995)));
  stage.classList.toggle('is-famine', fx.famine > 0);
}

function updateStats() {
  const souls = sim.population * M;
  el.statGen.textContent = sim.life.generation;
  el.statSouls.textContent = compact(souls);
  el.statBirths.textContent = sim.life.births;
  el.statDeaths.textContent = sim.life.deaths;
  el.statFps.textContent = Math.round(fpsAvg);

  el.popValue.textContent = compact(souls);
  el.popRaw.textContent = withCommas(souls);
  el.peak.textContent = compact(sim.peak * M);
  el.lost.textContent = compact(sim.totalLost * M);
  el.eventCount.textContent = String(eventTotal);

  const now = performance.now();
  const dt = (now - lastUiPopTime) / 1000;
  if (dt > 0.5) {
    const diff = sim.population - lastUiPop;
    const pct = lastUiPop > 0 ? (diff / lastUiPop) * 100 : 0;
    el.popDelta.classList.remove('up', 'down');
    if (Math.abs(pct) < 0.08) {
      el.popDelta.textContent = 'STABLE';
    } else {
      el.popDelta.textContent = `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`;
      el.popDelta.classList.add(pct > 0 ? 'up' : 'down');
    }
    lastUiPop = sim.population;
    lastUiPopTime = now;
  }
}

function updateCivilizationUI() {
  const civ = sim.civilization;
  if (!civ) return;

  // Era
  const eraNames = ['Nomadic', 'Agricultural', 'Industrial', 'Space-faring'];
  const era = Math.min(civ.tier, 3);
  el.statEra.textContent = eraNames[era];
  el.statEra.style.color = ['#9dffe2', '#ffc76b', '#ff8a2b', '#7af2c9'][era];
  el.civEraFill.style.width = `${(era / 3) * 100}%`;
  el.civEraMeta.textContent = eraNames[era];

  // Alignment
  const align = Math.round(civ.alignment);
  el.statAlignment.textContent = `${align > 0 ? '+' : ''}${align}`;
  el.statAlignment.style.color = civ.moodColor;
  el.civMoodFill.style.width = `${(civ.alignment + 100) / 200 * 100}%`;
  el.civMoodMeta.textContent = civ.alignmentLabel;

  // Mood label
  const moodLabels = {
    Benevolent: 'Blessings flow. Temples rise.',
    Kind: 'The world favors you.',
    Neutral: 'The world balances.',
    Harsh: 'Shadows gather. Defenses rise.',
    Wrathful: 'They fear you. Shields glow.',
  };
  el.civMoodLabel.textContent = moodLabels[civ.alignmentLabel] || 'The world balances.';

  // Worship
  el.statWorship.textContent = `${Math.round(civ.worship * 100)}%`;
  el.civWorshipFill.style.width = `${civ.worship * 100}%`;
  el.civWorshipMeta.textContent = `${Math.round(civ.worship * 100)}%`;

  // Temples & Defense
  el.civTemples.textContent = Math.round(civ.templesBuilt);
  el.civDefense.textContent = Math.round(civ.defenseBuilt);
}

function updateActiveCasualties() {
  for (const d of sim.disasters) {
    if (d.logCas) d.logCas.textContent = compact(d.cas * M);
  }
}

function updateSmiteButtons() {
  const active = new Set(sim.disasters.map((d) => d.type));
  document.querySelectorAll('.smite').forEach((b) => {
    b.classList.toggle('active', active.has(b.dataset.smite));
  });
}

function drawChart() {
  const c = el.chart;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const data = sim.history;
  if (!data.length) return;

  let max = 1;
  for (const d of data) max = Math.max(max, d.pop);
  const n = data.length;
  const pad = 6;
  const windowSize = Math.min(n, 160);
  const first = n - windowSize;
  const x = (i) => pad + ((i - first) / Math.max(1, windowSize - 1)) * (w - pad * 2);
  const y = (v) => h - pad - (v / (max * 1.12)) * (h - pad * 2);

  // markers
  for (let i = first; i < n; i++) {
    for (const ev of data[i].events) {
      ctx.strokeStyle = ev.color + '66';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(i), 2);
      ctx.lineTo(x(i), h - 2);
      ctx.stroke();
    }
  }

  // area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(94,242,196,0.3)');
  grad.addColorStop(1, 'rgba(94,242,196,0)');
  ctx.beginPath();
  ctx.moveTo(x(first), h - pad);
  for (let i = first; i < n; i++) ctx.lineTo(x(i), y(data[i].pop));
  ctx.lineTo(x(n - 1), h - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  for (let i = first; i < n; i++) {
    const px = x(i);
    const py = y(data[i].pop);
    if (i === first) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = '#5ef2c4';
  ctx.lineWidth = 1.4;
  ctx.shadowColor = 'rgba(94,242,196,0.55)';
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // last point
  if (n) {
    const px = x(n - 1);
    const py = y(data[n - 1].pop);
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#c9fff0';
    ctx.fill();
  }
}

function uiTick() {
  updateStats();
  renderActive();
  updateActiveCasualties();
  updateSmiteButtons();
  updateCivilizationUI();
  setStageClass();
}

/* ------------------------------------------------------------------ sliders */

const formats = {
  speed: (v) => `${v.toFixed(1)}/s`,
  birth: (v) => String(v),
  surviveMin: (v) => String(v),
  surviveMax: (v) => String(v),
  mutation: (v) => `${v.toFixed(2)}%`,
  disaster: (v) => String(v),
  severity: (v) => String(v),
  war: (v) => String(v),
  glow: (v) => String(v),
};

const valueIds = {
  speed: 'val-speed',
  birth: 'val-birth',
  surviveMin: 'val-smin',
  surviveMax: 'val-smax',
  mutation: 'val-mut',
  disaster: 'val-disaster',
  severity: 'val-severity',
  war: 'val-war',
  glow: 'val-glow',
};

function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const p = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}

document.querySelectorAll('input[type="range"]').forEach((input) => {
  const key = input.dataset.param;
  const out = document.getElementById(valueIds[key]);
  const sync = () => {
    const v = Number(input.value);
    sim.setParam(key, v);
    out.textContent = formats[key](v);
    paintRange(input);
    if (key === 'glow') world.setGlow(v / 100);
    if (key === 'surviveMin') {
      const max = document.getElementById('sl-smax');
      if (Number(input.value) > Number(max.value)) {
        max.value = input.value;
        max.dispatchEvent(new Event('input'));
      }
    }
    if (key === 'surviveMax') {
      const min = document.getElementById('sl-smin');
      if (Number(input.value) < Number(min.value)) {
        min.value = input.value;
        min.dispatchEvent(new Event('input'));
      }
    }
  };
  input.addEventListener('input', sync);
  paintRange(input);
});

/* ------------------------------------------------------------------ actions */

function togglePause() {
  sim.paused = !sim.paused;
  el.btnPause.textContent = sim.paused ? 'RESUME' : 'PAUSE';
  el.btnPause.classList.toggle('paused', sim.paused);
  el.livePill.innerHTML = `<i></i> ${sim.paused ? 'SIMULATION PAUSED' : 'LIVE SIMULATION'}`;
  el.livePill.style.color = sim.paused ? '#ffc76b' : '';
}

function reseed() {
  const previousEvents = eventTotal;
  sim.reseed();
  world.refreshCells();
  world.setGlow(sim.params.glow / 100);
  lastVersion = sim.version;
  el.logList.innerHTML = '';
  addLog({
    type: 'earthquake',
    name: 'New World',
    desc: 'The crust cools and life takes hold again.',
    color: '#5ef2c4',
    cas: 0,
    manual: true,
  });
  eventTotal = previousEvents;
  el.logCount.textContent = `${eventTotal} EVENTS`;
  flash('#5ef2c4');
  uiTick();
  drawChart();
}

function clearWorld() {
  sim.clear();
  world.refreshCells();
  lastVersion = sim.version;
  addLog({
    type: 'war',
    name: 'Extinction',
    desc: 'The last cell divides no more. The world is sterile.',
    color: '#6f9a93',
    cas: 0,
    manual: true,
  });
  flash('#9dffe2');
  uiTick();
  drawChart();
}

el.btnPause.addEventListener('click', togglePause);
el.btnStep.addEventListener('click', () => {
  sim.stepOnce();
  world.refreshCells();
  lastVersion = sim.version;
});
el.btnReseed.addEventListener('click', reseed);
el.btnClear.addEventListener('click', clearWorld);

// V2: Divine Powers
if (el.btnBlessing) el.btnBlessing.addEventListener('click', () => {
  sim.triggerDivineBlessing();
  flash('#5ef2c4');
  uiTick();
});
if (el.btnRain) el.btnRain.addEventListener('click', () => {
  sim.triggerMiracleRain();
  flash('#4d9cff');
  uiTick();
});
if (el.btnMeteor) el.btnMeteor.addEventListener('click', () => {
  sim.triggerMeteorStrike();
  flash('#ff8a2b');
  uiTick();
});

document.querySelectorAll('.smite').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.smite;
    if (!sim.trigger(type, true)) {
      btn.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }],
        { duration: 180 }
      );
    }
  });
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    togglePause();
  } else if (k === 's') {
    sim.stepOnce();
    world.refreshCells();
    lastVersion = sim.version;
  } else if (k === 'r') {
    reseed();
  } else if (k === 'c') {
    clearWorld();
  } else if (k >= '1' && k <= '6') {
    const order = ['earthquake', 'plague', 'wildfire', 'flood', 'famine', 'war'];
    sim.trigger(order[Number(k) - 1], true);
  } else if (k === 'b') {
    sim.triggerDivineBlessing();
    flash('#5ef2c4');
    uiTick();
  } else if (k === 'r' && !e.target instanceof HTMLInputElement) {
    // Miracle Rain - but we already use 'r' for reseed,
    // so add a different key or make it a combo. Let's use ctrl+R
    // Actually, let's keep it simple and not double-bind 'r'
  } else if (k === 'm') {
    sim.triggerMeteorStrike();
    flash('#ff8a2b');
    uiTick();
  } else if (k === 'g') {
    document.querySelector('.dock')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
});

window.addEventListener('resize', () => {
  world.resize();
  drawChart();
});

if (window.ResizeObserver) {
  new ResizeObserver(() => {
    world.resize();
    drawChart();
  }).observe(stage);
}

/* ------------------------------------------------------------------ loop */

function frame(now) {
  const dt = Math.min(0.06, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  fpsAvg += (1 / Math.max(dt, 0.0001) - fpsAvg) * 0.05;

  sim.update(dt);

  if (sim.version !== lastVersion) {
    world.refreshCells();
    lastVersion = sim.version;
  }

  const fx = sim.effects;
  world.setFlood(fx.flood.active || fx.flood.level < 0.995, fx.flood.axis, fx.flood.level);
  world.update(dt);
  world.render(dt);

  uiAcc += dt;
  if (uiAcc > 0.1) {
    uiAcc = 0;
    uiTick();
  }
  chartAcc += dt;
  if (chartAcc > 0.25) {
    chartAcc = 0;
    drawChart();
  }

  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ start */

uiTick();
drawChart();
requestAnimationFrame((t) => {
  lastFrame = t;
  requestAnimationFrame(frame);
  setTimeout(() => boot.classList.add('gone'), 450);
});

// initial world readout
sim.peak = Math.max(sim.peak, sim.population);
window.PG = { sim, world, life, DISASTERS };

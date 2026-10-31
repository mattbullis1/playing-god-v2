/* PLAYING GOD V2 — world simulation
 * Runs the cellular automaton plus disasters, wars, casualties and history.
 */

import { CivilizationEngine } from './civilization/engine.js';

const M = 1_000_000; // one cell == one million souls

const WAR_NAMES = [
  ['The Azure Pact', 'The Ember Coalition'],
  ['The Northern League', 'The Southern Bloc'],
  ['The Republic of Ash', 'The Coral Dominion'],
  ['The Iron Concord', 'The Verdant Union'],
  ['The Pale Court', 'The Sunward Assembly'],
];

export const DISASTERS = {
  earthquake: {
    id: 'earthquake',
    name: 'Tectonic Rupture',
    short: 'EARTHQUAKE',
    color: '#ffbf5e',
    desc: 'A magnitude rupture splits the crust.',
    duration: 3.6,
  },
  plague: {
    id: 'plague',
    name: 'Crimson Plague',
    short: 'PLAGUE',
    color: '#ff4d61',
    desc: 'A pathogen breaches the population.',
    duration: 24,
  },
  wildfire: {
    id: 'wildfire',
    name: 'Wildfire',
    short: 'WILDFIRE',
    color: '#ff8a2b',
    desc: 'Firestorms sweep the biosphere.',
    duration: 22,
  },
  flood: {
    id: 'flood',
    name: 'The Deluge',
    short: 'FLOOD',
    color: '#4d9cff',
    desc: 'The oceans rise over the lowlands.',
    duration: 18,
  },
  famine: {
    id: 'famine',
    name: 'Famine',
    short: 'FAMINE',
    color: '#c79a52',
    desc: 'Harvests fail across the world.',
    duration: 22,
  },
  war: {
    id: 'war',
    name: 'War',
    short: 'WAR',
    color: '#ff7a6b',
    desc: 'Two blocs collide along a shifting front.',
    duration: 26,
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randomUnit = () => {
  const u = Math.random() * 2 - 1;
  const p = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return { x: Math.cos(p) * s, y: u, z: Math.sin(p) * s };
};

export class Simulation {
  constructor(life, hooks = {}) {
    this.life = life;
    this.hooks = hooks;
    this.n = life.n;

    this.params = {
      speed: 8,
      birth: 3,
      surviveMin: 2,
      surviveMax: 4,
      mutation: 0.03,
      disaster: 55,
      severity: 55,
      war: 30,
      glow: 82,
    };

    this.effects = {
      heat: new Float32Array(this.n),
      fire: new Float32Array(this.n),
      burn: new Uint8Array(this.n),
      scorch: new Float32Array(this.n),
      faction: new Int8Array(this.n),
      flood: { active: false, axis: { x: 0, y: 1, z: 0 }, level: 0 },
      war: { active: false, axis: { x: 0, y: 1, z: 0 }, width: 0 },
      plague: 0,
      famine: 0,
      divineBlessing: 0,
      miracleRain: 0,
      dirtyDead: false,
    };

    this.disasters = [];
    this.paused = false;
    this.genAcc = 0;
    this.version = 0;
    this.time = 0;
    this.sampleAcc = 0;

    this.totalLost = 0;
    this.population = life.countAlive();
    this.peak = this.population;
    this.history = [{ pop: this.population, events: [] }];
    this.historyMax = 420;

    this.nextDisaster = 7;
    this.nextWar = 26;

    this.warSides = WAR_NAMES[0];

    // V2: Autonomous Civilizations & Deity Alignment
    this.civilization = new CivilizationEngine(life, this);
  }

  setParam(key, value) {
    this.params[key] = value;
    if (key === 'speed' && this.genAcc > 1) this.genAcc = 0;
  }

  reseed() {
    this.life.seed(0.34, 26);
    this._resetEffects();
    this.version++;
    this.totalLost = 0;
    this.population = this.life.countAlive();
    this.peak = this.population;
    this.disasters = [];
    this.history = [{ pop: this.population, events: [] }];
    this.nextDisaster = 8;
    this.nextWar = 30;
    // Reset civilization
    this.civilization = new CivilizationEngine(this.life, this);
  }

  clear() {
    this.life.clear();
    this._resetEffects();
    this.version++;
    this.disasters = [];
    this.population = 0;
    this.peak = 0;
    this.history = [{ pop: 0, events: [] }];
    this.civilization = new CivilizationEngine(this.life, this);
  }

  // V2 new divine intervention buttons
  triggerDivineBlessing() {
    return this.civilization.triggerDivineBlessing();
  }

  triggerMiracleRain() {
    return this.civilization.triggerMiracleRain();
  }

  triggerMeteorStrike(pos) {
    return this.civilization.triggerMeteorStrike(pos);
  }

  get civilization() {
    return this._civilization;
  }

  set civilization(engine) {
    this._civilization = engine;
  }

  stepOnce() {
    this._step();
    this.version++;
  }

  _resetEffects() {
    const fx = this.effects;
    fx.heat.fill(0);
    fx.fire.fill(0);
    fx.burn.fill(0);
    fx.scorch.fill(0);
    fx.faction.fill(0);
    fx.flood.active = false;
    fx.flood.level = 1;
    fx.war.active = false;
    fx.plague = 0;
    fx.famine = 0;
    fx.divineBlessing = 0;
    fx.miracleRain = 0;
    fx.dirtyDead = true;
  }

  /* ------------------------------------------------------------- disasters */

  trigger(type, manual = false) {
    if (!DISASTERS[type]) return false;
    if (type === 'war' && this.disasters.some((d) => d.type === 'war')) return false;
    if (this.disasters.filter((d) => d.type === type).length) return false;
    if (!manual && this.disasters.length > 0) return false;

    const base = DISASTERS[type];
    const sev = clamp(this.params.severity / 100, 0.08, 1);
    const axis = randomUnit();
    const d = {
      type,
      name: base.name,
      short: base.short,
      color: base.color,
      desc: base.desc,
      sev,
      t: 0,
      dur: base.duration * (0.75 + sev * 0.6),
      cas: 0,
      gen: this.life.generation,
      manual,
      axis,
      width: 0,
    };

    if (type === 'earthquake') {
      d.epicentre = randomUnit();
      d.radius = 0.18 + sev * 0.62;
      d.dur = 3.2 + sev * 2;
      const cosR = Math.cos(d.radius);
      const cells = this.life.cellsNear(d.epicentre.x, d.epicentre.y, d.epicentre.z, cosR);
      let killed = 0;
      for (const i of cells) {
        if (!this.life.alive[i]) continue;
        const p = this.life.positions;
        const dot =
          p[i * 3] * d.epicentre.x + p[i * 3 + 1] * d.epicentre.y + p[i * 3 + 2] * d.epicentre.z;
        const edge = 1 - (Math.acos(clamp(dot, -1, 1)) / Math.max(d.radius, 0.001)) * 0.55;
        if (Math.random() < 0.72 * edge) {
          this._kill(i);
          this.effects.scorch[i] = 0.7;
          killed++;
        }
      }
      d.cas = killed;
      d.magnitude = (5 + sev * 3.9).toFixed(1);
      d.desc = `A magnitude ${d.magnitude} rupture tears through the crust.`;
      this.totalLost += killed;
      this.version++;
      this._fire('quake', d.epicentre, sev);
    }

    if (type === 'plague') {
      d.dur = 23 + sev * 22;
      d.infected = 0;
      const epicentre = randomUnit();
      d.epicentre = epicentre;
      const cells = this.life.cellsNear(epicentre.x, epicentre.y, epicentre.z, Math.cos(0.18 + sev * 0.16));
      for (const i of cells) {
        if (this.life.alive[i] && Math.random() < 0.7) {
          this.effects.heat[i] = 0.5 + Math.random() * 0.25;
          d.infected++;
        }
      }
      if (!d.infected) {
        for (const i of this._randomAlive(8)) {
          this.effects.heat[i] = 0.55;
          d.infected++;
        }
      }
      d.desc = 'A pathogen breaches the population; infection is spreading.';
    }

    if (type === 'wildfire') {
      const cells = this._randomAlive(3 + Math.round(sev * 6));
      for (const i of cells) {
        this.effects.fire[i] = 1;
        this.effects.burn[i] = 2;
      }
      d.dur = 18 + sev * 16;
      d.desc = 'Firestorms sweep the biosphere; the burn front is expanding.';
    }

    if (type === 'flood') {
      d.dur = 14 + sev * 12;
      d.coverage = 0.3 + sev * 0.55;
      d.level = 1;
      this.effects.flood.axis = axis;
      this.effects.flood.level = 1;
      this.effects.flood.active = true;
      d.desc = 'The oceans rise over the lowlands.';
    }

    if (type === 'famine') {
      d.dur = 20 + sev * 16;
      d.desc = 'Harvests fail; the population begins to starve.';
    }

    if (type === 'war') {
      d.dur = 24 + sev * 20;
      d.width = 0.05 + sev * 0.1;
      this.warSides = WAR_NAMES[(Math.random() * WAR_NAMES.length) | 0];
      d.sides = this.warSides;
      d.desc = `${this.warSides[0]} and ${this.warSides[1]} collide along a shifting front.`;
      this.effects.war.active = true;
      this.effects.war.axis = axis;
      this.effects.war.width = d.width;
      this._assignFactions(axis);
      this._fire('war', axis, sev);
    }

    this.disasters.push(d);
    const point = this.history[this.history.length - 1];
    if (point) point.events.push({ color: d.color, label: d.short });
    if (this.hooks.event) this.hooks.event(d, this.history.length - 1);
    return true;
  }

  _fire(kind, pos, sev) {
    if (this.hooks.vfx) this.hooks.vfx(kind, pos, sev);
  }

  _randomAlive(count) {
    const out = [];
    let guard = 0;
    while (out.length < count && guard < 2000) {
      guard++;
      const i = (Math.random() * this.n) | 0;
      if (this.life.alive[i] && !out.includes(i)) out.push(i);
    }
    return out;
  }

  _kill(i) {
    if (!this.life.alive[i]) return false;
    this.life.alive[i] = 0;
    this.life.age[i] = 0;
    this.version++;
    return true;
  }

  _assignFactions(axis) {
    const p = this.life.positions;
    const f = this.effects.faction;
    for (let i = 0; i < this.n; i++) {
      const dot = p[i * 3] * axis.x + p[i * 3 + 1] * axis.y + p[i * 3 + 2] * axis.z;
      f[i] = dot > 0 ? 1 : -1;
    }
  }

  /* ------------------------------------------------------------------ loop */

  update(dt) {
    if (this.paused) return;
    this.time += dt;

    // smooth the flood surface in real time
    const floodD = this.disasters.find((d) => d.type === 'flood');
    if (floodD) {
      const rise = Math.min(1, floodD.t / 3.4);
      const fall = Math.max(0, Math.min(1, (floodD.t - (floodD.dur - 4)) / 4));
      const target = 1 - floodD.coverage;
      floodD.level = 1 + (target - 1) * rise * (1 - fall);
      this.effects.flood.level = floodD.level;
      this.effects.flood.active = true;
    } else {
      this.effects.flood.level += (1 - this.effects.flood.level) * Math.min(1, dt * 0.7);
      if (this.effects.flood.level > 0.995) {
        this.effects.flood.level = 1;
        this.effects.flood.active = false;
      }
    }

    this.effects.plague = this.disasters.some((d) => d.type === 'plague') ? 1 : 0;
    this.effects.famine = this.disasters.some((d) => d.type === 'famine') ? 1 : 0;

    // advance disaster clocks
    for (const d of this.disasters) d.t += dt;
    const before = this.disasters.length;
    this.disasters = this.disasters.filter((d) => {
      if (d.t < d.dur) return true;
      if (d.type === 'war') {
        this.effects.war.active = false;
        this.effects.faction.fill(0);
      }
      if (d.type === 'flood') this.effects.flood.active = false;
      if (d.type === 'famine') this.effects.famine = 0;
      if (this.hooks.ended) this.hooks.ended(d);
      return false;
    });
    void before;

    // spawn new events
    this.nextDisaster -= dt;
    if (this.params.disaster > 0 && this.nextDisaster <= 0) {
      if (this.disasters.length === 0) {
        const pool = ['plague', 'wildfire', 'flood', 'famine', 'earthquake', 'earthquake', 'war'];
        const pick = pool[(Math.random() * pool.length) | 0];
        if (pick === 'war') this.trigger('war');
        else this.trigger(pick);
      }
      const rate = this.params.disaster / 100;
      this.nextDisaster = rand(9, 38) * (1 - rate * 0.72) + 4;
    }

    this.nextWar -= dt;
    if (this.params.war > 0 && this.nextWar <= 0) {
      if (this.disasters.length === 0) this.trigger('war');
      const wr = this.params.war / 100;
      this.nextWar = rand(18, 70) * (1 - wr * 0.7) + 6;
    }

    // V2: update civilizations
    if (this.civilization) this.civilization.update(dt);

    // generations
    const interval = 1 / Math.max(0.25, this.params.speed);
    this.genAcc += dt;
    let steps = 0;
    while (this.genAcc >= interval && steps < 5) {
      this.genAcc -= interval;
      this._step();
      steps++;
    }

    // history sample
    this.sampleAcc += dt;
    if (this.sampleAcc >= 0.14) {
      this.sampleAcc = 0;
      this.history.push({ pop: this.population, events: [] });
      if (this.history.length > this.historyMax) this.history.shift();
      this.peak = Math.max(this.peak, this.population);
    }
  }

  _step() {
    const p = this.params;
    this.life.step({
      birth: p.birth,
      surviveMin: p.surviveMin,
      surviveMax: p.surviveMax,
      mutation: p.mutation / 100,
    });
    let killed = 0;
    const fx = this.effects;

    for (const d of this.disasters) {
      if (d.type === 'plague') killed += this._tickPlague(d);
      else if (d.type === 'wildfire') killed += this._tickFire(d);
      else if (d.type === 'flood') killed += this._tickFlood(d);
      else if (d.type === 'famine') killed += this._tickFamine(d);
      else if (d.type === 'war') killed += this._tickWar(d);
      d.cas += 0; // per-tick casualty is accumulated below
    }

    this.totalLost += killed;
    this.population = this.life.countAlive();
    this.version++;
    this.effects.dirtyDead = true;

    // slow decay of scorched ground and residual heat
    const plagueLive = this.disasters.some((d) => d.type === 'plague');
    for (let i = 0; i < this.n; i++) {
      if (fx.scorch[i] > 0) fx.scorch[i] = Math.max(0, fx.scorch[i] - 0.0035);
      if (fx.heat[i] > 0) {
        if (!plagueLive) fx.heat[i] *= 0.985;
        else if (!this.life.alive[i]) fx.heat[i] *= 0.96;
      }
    }
    if (this.life.generation % 4 === 0) this.effects.dirtyDead = true;
  }

  _tickPlague(d) {
    const fx = this.effects;
    let kills = 0;
    let infected = 0;
    const alive = this.life.alive;
    const nb = this.life.neighbours;
    const slots = this.life.neighbourCount;
    const seed = 0.05 + d.sev * 0.07;

    for (let i = 0; i < this.n; i++) {
      if (fx.heat[i] <= 0.001) continue;
      if (!alive[i]) {
        fx.heat[i] *= 0.96;
        continue;
      }
      infected++;
      fx.heat[i] = Math.min(2.6, fx.heat[i] + seed);
      // contagion
      if (fx.heat[i] > 0.35) {
        const base = i * 12;
        const deg = slots[i];
        const tries = 2 + ((Math.random() * 3) | 0);
        for (let t = 0; t < tries; t++) {
          const j = nb[base + ((Math.random() * deg) | 0)];
          if (j >= 0 && alive[j] && fx.heat[j] < 0.3 && Math.random() < 0.5 + d.sev * 0.35) {
            fx.heat[j] = 0.22 + Math.random() * 0.25;
          }
        }
      }
      if (fx.heat[i] > 0.90 && Math.random() < 0.16 + d.sev * 0.32) {
        if (this._kill(i)) {
          kills++;
          d.cas++;
          fx.scorch[i] = 0.55;
          fx.heat[i] = 0.75;
        }
      }
    }

    // keep a small reservoir of infection alive so the plague reads on screen
    if (infected < 5) {
      for (const i of this._randomAlive(3)) {
        fx.heat[i] = 0.45;
        infected++;
      }
    }
    d.infected = infected;
    return kills;
  }

  _tickFire(d) {
    const fx = this.effects;
    let kills = 0;
    const alive = this.life.alive;
    const nb = this.life.neighbours;
    const slots = this.life.neighbourCount;
    const spread = 0.28 + d.sev * 0.4;

    for (let i = 0; i < this.n; i++) {
      if (fx.fire[i] <= 0) continue;
      if (!alive[i]) {
        fx.fire[i] = 0;
        continue;
      }
      if (fx.burn[i] > 0) {
        fx.burn[i]--;
        const base = i * 12;
        const deg = slots[i];
        const tries = 2 + ((Math.random() * 2) | 0);
        for (let t = 0; t < tries; t++) {
          const j = nb[base + ((Math.random() * deg) | 0)];
          if (j >= 0 && alive[j] && fx.fire[j] <= 0 && Math.random() < spread) {
            fx.fire[j] = 1;
            fx.burn[j] = 2 + ((Math.random() * 2) | 0);
          }
        }
      } else if (fx.burn[i] === 0) {
        if (this._kill(i)) {
          kills++;
          d.cas++;
        }
        fx.fire[i] = 0;
        fx.scorch[i] = 1;
      }
    }
    // extinguish once no fire remains
    let any = 0;
    for (let i = 0; i < this.n; i++) any += fx.fire[i] > 0 ? 1 : 0;
    if (!any) d.t = Math.max(d.t, d.dur);
    return kills;
  }

  _tickFlood(d) {
    const fx = this.effects;
    const axis = fx.flood.axis;
    const level = fx.flood.level;
    if (level < 0.02) return 0;
    let kills = 0;
    const p = this.life.positions;
    for (let i = 0; i < this.n; i++) {
      if (!this.life.alive[i]) continue;
      const dot = p[i * 3] * axis.x + p[i * 3 + 1] * axis.y + p[i * 3 + 2] * axis.z;
      if (dot > level && Math.random() < 0.09 + d.sev * 0.2) {
        if (this._kill(i)) {
          kills++;
          d.cas++;
        }
        fx.scorch[i] = 0;
      }
    }
    return kills;
  }

  _tickFamine(d) {
    let kills = 0;
    const prob = 0.0015 + d.sev * 0.0055;
    for (let i = 0; i < this.n; i++) {
      if (this.life.alive[i] && Math.random() < prob) {
        if (this._kill(i)) {
          kills++;
          d.cas++;
        }
      }
    }
    return kills;
  }

  _tickWar(d) {
    const fx = this.effects;
    const axis = fx.war.axis;
    const p = this.life.positions;
    const width = d.width;
    const prob = 0.05 + d.sev * 0.13;
    let kills = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.life.alive[i]) continue;
      const dot = p[i * 3] * axis.x + p[i * 3 + 1] * axis.y + p[i * 3 + 2] * axis.z;
      const abs = Math.abs(dot);
      if (abs < width && Math.random() < prob) {
        if (this._kill(i)) {
          kills++;
          d.cas++;
          fx.scorch[i] = 0.8;
          fx.faction[i] = 0;
        }
      } else if (abs < width * 2.6 && Math.random() < 0.012 + d.sev * 0.018) {
        if (this._kill(i)) {
          kills++;
          d.cas++;
          fx.scorch[i] = 0.5;
          fx.faction[i] = 0;
        }
      }
    }
    this._assignFactions(axis);
    return kills;
  }

  /* Casualty totals in souls, for the UI. */
  get souls() {
    return this.population * M;
  }

  get activeList() {
    return this.disasters;
  }
}

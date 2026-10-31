/* PLAYING GOD V2 — Autonomous Civilizations & Deity System */

const TIER = {
  NOMADIC: { name: 'Nomadic', threshold: 0, color: '#9dffe2', glow: '#2f907c' },
  AGRICULTURAL: { name: 'Agricultural', threshold: 180, color: '#ffc76b', glow: '#c79a52' },
  INDUSTRIAL: { name: 'Industrial', threshold: 600, color: '#ffb45e', glow: '#8a3d2a' },
  SPACE_FARING: { name: 'Space-faring', threshold: 1300, color: '#7af2c9', glow: '#4da8ff' },
};

export const CIV_ERAS = Object.values(TIER);

export class CivilizationEngine {
  constructor(life, sim) {
    this.life = life;
    this.sim = sim;
    this.n = life.n;

    // Civilization state
    this.alignment = 0; // -100 (Wrathful) to +100 (Benevolent)
    this.tier = 0; // index into CIV_ERAS
    this.maturity = 0; // 0-1 based on density & generation persistence
    this.templesBuilt = 0;
    this.defenseBuilt = 0;
    this.panic = 0; // 0-1
    this.worship = 0; // 0-1

    // Emergent architecture tracking
    this.cityNodes = []; // { idx, tier, glow, age }
    this.tradeRoutes = []; // { from, to, pulse, age }
    this.monoliths = []; // { pos: [x,y,z], tier, glow }
    this.temples = []; // { pos: [x,y,z], tier }
    this.defenses = []; // { pos: [x,y,z], tier }

    this.cityInterval = 0;
    this.routeInterval = 0;
  }

  update(dt) {
    this._updateEmergence(dt);
    this._updateAlignment(dt);
    this._updateCivilizationReaction();
  }

  // Civilization tier based on density + maturity
  get currentTierName() {
    return CIV_ERAS[Math.min(this.tier, 3)].name;
  }

  get alignmentLabel() {
    if (this.alignment > 40) return 'Benevolent';
    if (this.alignment > 0) return 'Kind';
    if (this.alignment > -40) return 'Neutral';
    if (this.alignment > -70) return 'Harsh';
    return 'Wrathful';
  }

  get moodColor() {
    const a = clamp(this.alignment, -100, 100);
    if (a > 30) return '#5ef2c4';
    if (a > -20) return '#ffc76b';
    if (a > -60) return '#ff8a2b';
    return '#ff4d61';
  }

  // Density + age maturity drives tier progression
  _updateEmergence(dt) {
    const aliveCount = this.sim.population;
    const maxPossible = this.n; // 2400 cells
    const density = aliveCount / maxPossible;
    const gen = this.life.generation || 1;

    // Maturity = density weighted by generation persistence
    const newMaturity = Math.min(1, density * 2.2 + Math.log(gen + 1) / 8);
    this.maturity = this.maturity + (newMaturity - this.maturity) * dt * 0.3;

    // Tier progression
    this.tier = this.maturity > 0.85 ? 3 : this.maturity > 0.6 ? 2 : this.maturity > 0.35 ? 1 : 0;

    // Spawn city nodes when mature
    this.cityInterval -= dt;
    if (this.cityInterval <= 0 && this.maturity > 0.4) {
      this.cityInterval = 2 + Math.random() * 4;
      this._spawnCityNode();
    }

    // Spawn trade routes between mature cities
    this.routeInterval -= dt;
    if (this.routeInterval <= 0 && this.cityNodes.length > 1) {
      this.routeInterval = 3 + Math.random() * 6;
      this._spawnTradeRoute();
    }

    // Age out old architecture when destroyed by disasters
    this.cityNodes = this.cityNodes.filter(c => {
      const alive = this.life.alive[c.idx];
      c.age += dt;
      return alive && c.age < 300;
    });
    this.tradeRoutes = this.tradeRoutes.filter(r => {
      r.age += dt;
      return r.age < 120 && this.life.alive[r.from] && this.life.alive[r.to];
    });
  }

  _spawnCityNode() {
    const aliveIndices = [];
    for (let i = 0; i < this.n; i++) {
      if (this.life.alive[i]) aliveIndices.push(i);
    }
    if (aliveIndices.length < 10) return;

    // Pick clusters: find dense neighborhood
    for (let attempt = 0; attempt < 20; attempt++) {
      const pick = aliveIndices[(Math.random() * aliveIndices.length) | 0];
      const nb = this.life.neighbours;
      const count = this.life.neighbourCount[pick];
      if (count >= 4) {
        const p = this.life.positions;
        this.cityNodes.push({
          idx: pick,
          tier: Math.min(this.tier, 3),
          glow: 0.4 + Math.random() * 0.6,
          age: 0,
        });
        break;
      }
    }
  }

  _spawnTradeRoute() {
    if (this.cityNodes.length < 2) return;
    const from = this.cityNodes[(Math.random() * this.cityNodes.length) | 0];
    let to = this.cityNodes[(Math.random() * this.cityNodes.length) | 0];
    let tries = 0;
    while (to === from && tries < 10) {
      to = this.cityNodes[(Math.random() * this.cityNodes.length) | 0];
      tries++;
    }
    this.tradeRoutes.push({
      from: from.idx,
      to: to.idx,
      pulse: Math.random(),
      age: 0,
    });
  }

  // Deity alignment dynamics
  _updateAlignment(dt) {
    // Base decay toward neutral
    this.alignment += (-this.alignment) * dt * 0.08;

    // Positive: healing / blessing actions
    const blessing = this.sim.effects.divineBlessing || 0;
    const rain = this.sim.effects.miracleRain || 0;
    this.alignment += (blessing * 0.12 + rain * 0.08) * dt;

    // Negative: disasters cause wrath
    const activeDisasters = this.sim.disasters.length;
    this.alignment -= activeDisasters * 6 * dt;

    // Civilization reaction
    if (this.panic > 0.45) {
      // Defensive reaction against wrathful god
      this.defenseBuilt += dt * 0.35;
    } else if (this.worship > 0.45) {
      // Temple building for benevolent god
      this.templesBuilt += dt * 0.45;
    }

    // Clamp
    this.alignment = clamp(this.alignment, -100, 100);
  }

  // Reaction to god's actions
  _updateCivilizationReaction() {
    const disastersActive = this.sim.disasters.length > 0;
    const disasterSeverity = this.sim.disasters.reduce((s, d) => s + (d.sev || 0.5), 0);

    // Panic rises with disaster severity; worship rises with absence
    if (disastersActive) {
      this.panic += disasterSeverity * 0.015;
      this.worship -= 0.01;
    } else {
      this.panic = Math.max(0, this.panic - 0.008);
      this.worship += 0.012;
    }

    this.panic = clamp(this.panic, 0, 1);
    this.worship = clamp(this.worship, 0, 1);
  }

  // Active god powers
  triggerDivineBlessing() {
    // Heal plague and extinguish fire; accelerate growth
    const fx = this.sim.effects;
    for (let i = 0; i < this.n; i++) {
      if (this.life.alive[i]) {
        fx.heat[i] = Math.max(0, fx.heat[i] - 0.35);
        fx.fire[i] = 0;
        fx.burn[i] = 0;
      }
    }
    this.sim.effects.divineBlessing = 1;
    this.alignment += 15; // strengthens alignment
    this.sim.version++;
  }

  triggerMiracleRain() {
    // Extinguish all fires, lower flood, reverse scorch
    const fx = this.sim.effects;
    for (let i = 0; i < this.n; i++) {
      fx.fire[i] = 0;
      fx.burn[i] = 0;
    }
    fx.flood.active = false;
    fx.flood.level = 1;
    for (let i = 0; i < this.n; i++) {
      fx.scorch[i] = Math.max(0, fx.scorch[i] - 0.3);
      if (this.life.alive[i]) fx.heat[i] = Math.max(0, fx.heat[i] - 0.15);
    }
    this.sim.effects.miracleRain = 1;
    this.alignment += 20;
    this.sim.version++;
  }

  triggerMeteorStrike(pos) {
    // Heavy impact at target position
    const epic = pos || { x: 0, y: 0, z: 1 };
    this.sim.trigger('earthquake', true);
    this.alignment -= 25;
    this.sim.version++;
  }

  // Architecture data for renderer
  get architecture() {
    return {
      tier: this.tier,
      cities: this.cityNodes,
      routes: this.tradeRoutes,
      temples: this.temples,
      defenses: this.defenses,
      panic: this.panic,
      worship: this.worship,
      maturity: this.maturity,
    };
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

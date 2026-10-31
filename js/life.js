/* PLAYING GOD — spherical cellular automaton
 * A Conway-style Life world mapped onto a Fibonacci sphere.
 * Every cell has its 8 nearest neighbours; rules are classic B/S counts.
 */

export const NEIGHBOUR_SLOTS = 12;

export class LifeWorld {
  constructor(count = 2400) {
    this.n = count;
    this.alive = new Uint8Array(count);
    this.next = new Uint8Array(count);
    this.age = new Uint16Array(count);
    this.neighbourCount = new Uint8Array(count);
    this.neighbours = new Int32Array(count * NEIGHBOUR_SLOTS).fill(-1);
    this.positions = new Float32Array(count * 3);
    this.births = 0;
    this.deaths = 0;
    this.generation = 0;

    this._buildSphere();
    this._buildNeighbours();
    this.seed(0.34, 26);
  }

  /* Even point distribution on a unit sphere (golden-angle spiral). */
  _buildSphere() {
    const n = this.n;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      this.positions[i * 3] = Math.cos(theta) * r;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = Math.sin(theta) * r;
    }
  }

  /* 8 nearest neighbours, then mirrored so the graph is undirected. */
  _buildNeighbours() {
    const n = this.n;
    const p = this.positions;
    const K = 8;
    const bestD = new Float64Array(K);
    const bestI = new Int32Array(K);
    const directed = [];

    for (let i = 0; i < n; i++) {
      bestD.fill(Infinity);
      bestI.fill(-1);
      const ix = p[i * 3];
      const iy = p[i * 3 + 1];
      const iz = p[i * 3 + 2];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = ix - p[j * 3];
        const dy = iy - p[j * 3 + 1];
        const dz = iz - p[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bestD[K - 1]) continue;
        let k = K - 1;
        while (k > 0 && bestD[k - 1] > d2) {
          bestD[k] = bestD[k - 1];
          bestI[k] = bestI[k - 1];
          k--;
        }
        bestD[k] = d2;
        bestI[k] = j;
      }
      directed.push(bestI.slice());
    }

    const sets = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < n; i++) {
      for (const j of directed[i]) {
        if (j < 0) continue;
        sets[i].add(j);
        sets[j].add(i);
      }
    }

    for (let i = 0; i < n; i++) {
      let k = 0;
      for (const j of sets[i]) {
        if (k >= NEIGHBOUR_SLOTS) break;
        this.neighbours[i * NEIGHBOUR_SLOTS + k] = j;
        k++;
      }
      this.neighbourCount[i] = k;
    }
  }

  clear() {
    this.alive.fill(0);
    this.age.fill(0);
    this.generation = 0;
    this.births = 0;
    this.deaths = 0;
  }

  toggle(i) {
    this.alive[i] = this.alive[i] ? 0 : 1;
    if (this.alive[i]) this.age[i] = 1;
    return this.alive[i];
  }

  /* Scatter organic clusters rather than uniform noise. */
  seed(density = 0.34, clusters = 24) {
    this.clear();
    const n = this.n;
    const targets = Math.round(n * density);
    const centers = [];
    for (let c = 0; c < clusters; c++) centers.push((Math.random() * n) | 0);

    let placed = 0;
    let guard = 0;
    while (placed < targets && guard < n * 30) {
      guard++;
      const center = centers[(Math.random() * centers.length) | 0];
      // random walk out from a cluster seed
      let cur = center;
      const steps = 1 + ((Math.random() * 7) | 0);
      for (let s = 0; s < steps; s++) {
        const base = cur * NEIGHBOUR_SLOTS;
        const d = this.neighbourCount[cur];
        if (!d) break;
        cur = this.neighbours[base + ((Math.random() * d) | 0)];
      }
      if (!this.alive[cur]) {
        this.alive[cur] = 1;
        this.age[cur] = 1 + ((Math.random() * 4) | 0);
        placed++;
      }
    }
  }

  step({ birth = 3, surviveMin = 2, surviveMax = 3, mutation = 0.0003 } = {}) {
    const n = this.n;
    const alive = this.alive;
    const next = this.next;
    const nb = this.neighbours;
    let born = 0;
    let died = 0;

    for (let i = 0; i < n; i++) {
      const base = i * NEIGHBOUR_SLOTS;
      const d = this.neighbourCount[i];
      let count = 0;
      for (let k = 0; k < d; k++) {
        if (alive[nb[base + k]]) count++;
      }

      let live = 0;
      if (alive[i]) {
        live = count >= surviveMin && count <= surviveMax ? 1 : 0;
      } else {
        live = count === birth ? 1 : 0;
      }

      if (mutation > 0 && Math.random() < mutation) live = live ? 0 : 1;

      if (live && !alive[i]) {
        born++;
        this.age[i] = 1;
      } else if (!live && alive[i]) {
        died++;
        this.age[i] = 0;
      } else if (live) {
        this.age[i] = Math.min(60000, this.age[i] + 1);
      }
      next[i] = live;
    }

    this.next = alive;
    this.alive = next;
    this.generation++;
    this.births = born;
    this.deaths = died;
    return { born, died };
  }

  countAlive() {
    let c = 0;
    for (let i = 0; i < this.n; i++) c += this.alive[i];
    return c;
  }

  /* Cells within an angular radius of a surface direction. */
  cellsNear(x, y, z, cosRadius) {
    const out = [];
    const p = this.positions;
    for (let i = 0; i < this.n; i++) {
      const dot = p[i * 3] * x + p[i * 3 + 1] * y + p[i * 3 + 2] * z;
      if (dot >= cosRadius) out.push(i);
    }
    return out;
  }
}

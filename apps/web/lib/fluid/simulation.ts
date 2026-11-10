// Particle fluid in an axis-aligned tank, solved with double density relaxation
// (Clavet, Beaudoin, Poulin: "Particle-based Viscoelastic Fluid Simulation", 2005).
// The tank never moves: tilting and shaking are expressed through the gravity vector.

export type Vec3 = readonly [number, number, number];

const TANK_HALF: Vec3 = [1, 0.75, 0.6];
/** Share of the tank volume the liquid occupies when the particle limit is reached. */
const FULL_FRACTION = 0.45;
/** Share of the particle limit present after a reset; the rest can be poured in. */
const INITIAL_FRACTION = 0.6;

/** The time step, in seconds, that the stiffness constants are tuned for. */
export const STEP = 1 / 60;

const REST_DENSITY = 3;
const STIFFNESS = 50;
const NEAR_STIFFNESS = 120;
/** Linear viscosity coefficient (1/s) at viscosity = 1. */
const VISCOSITY_SCALE = 60;
const POUR_SPEED = 2;
const MAX_NEIGHBOURS = 96;

export class Fluid {
  readonly half: Vec3 = TANK_HALF;
  /** Rest distance between neighbouring particles. */
  readonly spacing: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  count = 0;

  private readonly h: number;
  private readonly previous: Float32Array;
  private readonly cells: Vec3;
  private readonly cellStart: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly sorted: Int32Array;
  private readonly neighbour = new Int32Array(MAX_NEIGHBOURS);
  private readonly neighbourQ = new Float32Array(MAX_NEIGHBOURS);
  private readonly neighbourDir = new Float32Array(MAX_NEIGHBOURS * 3);
  private seed = 1;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Particle limit must be a positive integer, got ${limit}`);
    const [hx, hy, hz] = this.half;
    this.spacing = Math.cbrt((FULL_FRACTION * 8 * hx * hy * hz) / limit);
    this.h = this.spacing * 2;
    this.positions = new Float32Array(limit * 3);
    this.velocities = new Float32Array(limit * 3);
    this.previous = new Float32Array(limit * 3);
    this.cells = [Math.ceil((2 * hx) / this.h), Math.ceil((2 * hy) / this.h), Math.ceil((2 * hz) / this.h)];
    this.cellStart = new Int32Array(this.cells[0] * this.cells[1] * this.cells[2] + 1);
    this.cellOf = new Int32Array(limit);
    this.sorted = new Int32Array(limit);
    this.reset();
  }

  /** Refills the tank with a block of liquid at rest against the −X wall. */
  reset(): void {
    const [hx, hy, hz] = this.half;
    const s = this.spacing;
    const target = Math.round(this.limit * INITIAL_FRACTION);
    const columns = Math.floor(hx / s);
    const rows = Math.floor((2 * hz) / s);
    this.seed = 1;
    this.velocities.fill(0);
    this.count = 0;
    for (let n = 0; n < target; n++) {
      const layer = Math.floor(n / (columns * rows));
      const row = Math.floor(n / columns) % rows;
      const column = n % columns;
      this.add(
        -hx + (column + 0.5) * s + this.jitter(),
        -hy + (layer + 0.5) * s + this.jitter(),
        -hz + (row + 0.5) * s + this.jitter(),
        0,
      );
    }
  }

  /** Adds up to `amount` particles falling from the top centre of the tank. */
  pour(amount: number): void {
    const top = this.half[1] - this.h;
    const radius = this.h * 1.5;
    for (let n = 0; n < amount && this.count < this.limit; n++) {
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * radius;
      this.add(Math.cos(angle) * distance, top + this.jitter() * 10, Math.sin(angle) * distance, -POUR_SPEED);
    }
  }

  /** Adds `impulse` to the velocity of particles within `radius` of a ray, fading with distance. */
  push(origin: Vec3, direction: Vec3, radius: number, impulse: Vec3): void {
    const p = this.positions;
    const v = this.velocities;
    for (let i = 0; i < this.count * 3; i += 3) {
      const ox = p[i]! - origin[0];
      const oy = p[i + 1]! - origin[1];
      const oz = p[i + 2]! - origin[2];
      const along = ox * direction[0] + oy * direction[1] + oz * direction[2];
      const px = ox - along * direction[0];
      const py = oy - along * direction[1];
      const pz = oz - along * direction[2];
      const distance = Math.sqrt(px * px + py * py + pz * pz);
      if (distance >= radius) continue;
      const weight = 1 - distance / radius;
      v[i] = v[i]! + impulse[0] * weight;
      v[i + 1] = v[i + 1]! + impulse[1] * weight;
      v[i + 2] = v[i + 2]! + impulse[2] * weight;
    }
  }

  /**
   * Advances the fluid by `dt` seconds. `viscosity` ranges from 0 (water) to 1 (syrup).
   * The stiffness constants are tuned for dt = STEP; larger steps are unstable.
   */
  step(dt: number, gravity: Vec3, viscosity: number): void {
    const p = this.positions;
    const v = this.velocities;
    const previous = this.previous;
    const n3 = this.count * 3;

    for (let i = 0; i < n3; i += 3) {
      v[i] = v[i]! + gravity[0] * dt;
      v[i + 1] = v[i + 1]! + gravity[1] * dt;
      v[i + 2] = v[i + 2]! + gravity[2] * dt;
    }

    // A particle may cross at most half its interaction radius per step.
    const maxSpeed = (0.5 * this.h) / dt;
    for (let i = 0; i < n3; i += 3) {
      const speed = Math.sqrt(v[i]! * v[i]! + v[i + 1]! * v[i + 1]! + v[i + 2]! * v[i + 2]!);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        v[i] = v[i]! * scale;
        v[i + 1] = v[i + 1]! * scale;
        v[i + 2] = v[i + 2]! * scale;
      }
    }
    previous.set(p.subarray(0, n3));
    for (let i = 0; i < n3; i++) p[i] = p[i]! + v[i]! * dt;

    this.buildGrid();
    this.relax(dt, dt * viscosity * VISCOSITY_SCALE);

    for (let i = 0; i < n3; i++) {
      // Particle centres stop one radius short of the glass.
      const reach = this.half[i % 3]! - this.spacing / 2;
      p[i] = Math.min(reach, Math.max(-reach, p[i]!));
      v[i] = (p[i]! - previous[i]!) / dt;
    }
  }

  /**
   * One pass over every particle's neighbourhood. Viscosity pulls the velocities of approaching
   * neighbours together; density relaxation moves particles apart where the liquid is compressed
   * and together where it is stretched. Both act on positions; `step` derives velocities afterwards.
   */
  private relax(dt: number, viscosity: number): void {
    const p = this.positions;
    const v = this.velocities;
    const q = this.neighbourQ;
    const dir = this.neighbourDir;
    const dt2 = dt * dt;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const found = this.collectNeighbours(i);
      let density = 0;
      let nearDensity = 0;
      for (let k = 0; k < found; k++) {
        const a = 1 - q[k]!;
        density += a * a;
        nearDensity += a * a * a;
      }
      const pressure = STIFFNESS * (density - REST_DENSITY);
      const nearPressure = NEAR_STIFFNESS * nearDensity;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let k = 0; k < found; k++) {
        const j3 = this.neighbour[k]! * 3;
        const a = 1 - q[k]!;
        const dx = dir[k * 3]!;
        const dy = dir[k * 3 + 1]!;
        const dz = dir[k * 3 + 2]!;
        let move = 0.5 * dt2 * (pressure * a + nearPressure * a * a);
        if (viscosity > 0 && j3 > i3) {
          const approach = (v[i3]! - v[j3]!) * dx + (v[i3 + 1]! - v[j3 + 1]!) * dy + (v[i3 + 2]! - v[j3 + 2]!) * dz;
          if (approach > 0) {
            const impulse = 0.5 * approach * Math.min(1, viscosity * a);
            v[i3] = v[i3]! - impulse * dx;
            v[i3 + 1] = v[i3 + 1]! - impulse * dy;
            v[i3 + 2] = v[i3 + 2]! - impulse * dz;
            v[j3] = v[j3]! + impulse * dx;
            v[j3 + 1] = v[j3 + 1]! + impulse * dy;
            v[j3 + 2] = v[j3 + 2]! + impulse * dz;
            move += impulse * dt;
          }
        }
        p[j3] = p[j3]! + dx * move;
        p[j3 + 1] = p[j3 + 1]! + dy * move;
        p[j3 + 2] = p[j3 + 2]! + dz * move;
        mx -= dx * move;
        my -= dy * move;
        mz -= dz * move;
      }
      p[i3] = p[i3]! + mx;
      p[i3 + 1] = p[i3 + 1]! + my;
      p[i3 + 2] = p[i3 + 2]! + mz;
    }
  }

  /** Sorts particle indices by grid cell so each cell's particles are contiguous in `sorted`. */
  private buildGrid(): void {
    const [nx, ny, nz] = this.cells;
    const p = this.positions;
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < this.count; i++) {
      const cx = this.cellCoord(p[i * 3]!, 0);
      const cy = this.cellCoord(p[i * 3 + 1]!, 1);
      const cz = this.cellCoord(p[i * 3 + 2]!, 2);
      const cell = (cz * ny + cy) * nx + cx;
      this.cellOf[i] = cell;
      start[cell] = start[cell]! + 1;
    }
    // After the prefix sum start[c] is the end of cell c; filling backwards leaves it at the cell's first slot.
    for (let c = 1; c <= nx * ny * nz; c++) start[c] = start[c]! + start[c - 1]!;
    for (let i = 0; i < this.count; i++) {
      const cell = this.cellOf[i]!;
      start[cell] = start[cell]! - 1;
      this.sorted[start[cell]!] = i;
    }
  }

  private cellCoord(value: number, axis: 0 | 1 | 2): number {
    const coord = Math.floor((value + this.half[axis]) / this.h);
    return Math.min(this.cells[axis] - 1, Math.max(0, coord));
  }

  /** Fills the neighbour buffers for particle `i` and returns how many were found. */
  private collectNeighbours(i: number): number {
    const [nx, ny, nz] = this.cells;
    const p = this.positions;
    const h = this.h;
    const x = p[i * 3]!;
    const y = p[i * 3 + 1]!;
    const z = p[i * 3 + 2]!;
    const cx = this.cellCoord(x, 0);
    const cy = this.cellCoord(y, 1);
    const cz = this.cellCoord(z, 2);
    let found = 0;
    for (let gz = Math.max(0, cz - 1); gz <= Math.min(nz - 1, cz + 1); gz++) {
      for (let gy = Math.max(0, cy - 1); gy <= Math.min(ny - 1, cy + 1); gy++) {
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(nx - 1, cx + 1); gx++) {
          const cell = (gz * ny + gy) * nx + gx;
          for (let s = this.cellStart[cell]!; s < this.cellStart[cell + 1]!; s++) {
            const j = this.sorted[s]!;
            if (j === i) continue;
            const dx = p[j * 3]! - x;
            const dy = p[j * 3 + 1]! - y;
            const dz = p[j * 3 + 2]! - z;
            const squared = dx * dx + dy * dy + dz * dz;
            if (squared >= h * h || found === MAX_NEIGHBOURS) continue;
            const distance = Math.sqrt(squared);
            this.neighbour[found] = j;
            this.neighbourQ[found] = distance / h;
            // Coincident particles separate along the direction of their index order.
            const inverse = distance > 1e-9 ? 1 / distance : 0;
            this.neighbourDir[found * 3] = dx * inverse;
            this.neighbourDir[found * 3 + 1] = distance > 1e-9 ? dy * inverse : j > i ? 1 : -1;
            this.neighbourDir[found * 3 + 2] = dz * inverse;
            found++;
          }
        }
      }
    }
    return found;
  }

  private add(x: number, y: number, z: number, vy: number): void {
    const i = this.count * 3;
    this.positions[i] = x;
    this.positions[i + 1] = y;
    this.positions[i + 2] = z;
    this.velocities[i] = 0;
    this.velocities[i + 1] = vy;
    this.velocities[i + 2] = 0;
    this.count++;
  }

  /** Deterministic pseudo-random number in [0, 1) (mulberry32). */
  private random(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private jitter(): number {
    return (this.random() - 0.5) * this.spacing * 0.02;
  }
}

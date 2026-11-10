import { describe, expect, it } from 'vitest';
import { Fluid, STEP, type Vec3 } from './simulation';

const DT = STEP;
const DOWN: Vec3 = [0, -9.8, 0];

function run(fluid: Fluid, steps: number, gravity: Vec3, viscosity = 0.1) {
  for (let i = 0; i < steps; i++) fluid.step(DT, gravity, viscosity);
}

function mean(fluid: Fluid, axis: 0 | 1 | 2, values = fluid.positions) {
  let sum = 0;
  for (let i = 0; i < fluid.count; i++) sum += values[i * 3 + axis]!;
  return sum / fluid.count;
}

function meanSpeed(fluid: Fluid) {
  let sum = 0;
  for (let i = 0; i < fluid.count; i++) {
    sum += Math.hypot(fluid.velocities[i * 3]!, fluid.velocities[i * 3 + 1]!, fluid.velocities[i * 3 + 2]!);
  }
  return sum / fluid.count;
}

function expectFiniteAndInside(fluid: Fluid) {
  for (let i = 0; i < fluid.count * 3; i++) {
    if (!Number.isFinite(fluid.velocities[i]) || !(Math.abs(fluid.positions[i]!) < fluid.half[i % 3]!)) {
      throw new Error(`Particle ${Math.floor(i / 3)} left the tank or became non-finite`);
    }
  }
}

describe('Fluid', () => {
  it('rejects a particle limit that is not a positive integer', () => {
    expect(() => new Fluid(0)).toThrow();
    expect(() => new Fluid(12.5)).toThrow();
  });

  it('keeps every particle inside the tank', () => {
    const fluid = new Fluid(1000);
    run(fluid, 300, DOWN);
    expectFiniteAndInside(fluid);
  });

  it('settles under gravity', () => {
    const fluid = new Fluid(1000);
    const startHeight = mean(fluid, 1);
    run(fluid, 900, DOWN);
    expect(mean(fluid, 1)).toBeLessThan(startHeight);
    expect(meanSpeed(fluid)).toBeLessThan(0.15);
  });

  it('spreads across the floor instead of collapsing into a clump', () => {
    const fluid = new Fluid(1000);
    run(fluid, 900, DOWN);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < fluid.count; i++) {
      minX = Math.min(minX, fluid.positions[i * 3]!);
      maxX = Math.max(maxX, fluid.positions[i * 3]!);
    }
    expect(maxX - minX).toBeGreaterThan(fluid.half[0] * 1.8);
    // Resting liquid keeps most of its volume: an incompressible pool would have its mean height at half its depth.
    const depth = (fluid.count * fluid.spacing ** 3) / (4 * fluid.half[0] * fluid.half[2]);
    expect(mean(fluid, 1) + fluid.half[1]).toBeGreaterThan(depth * 0.35);
  });

  it('moves toward the low side when gravity is tilted', () => {
    const fluid = new Fluid(1000);
    run(fluid, 600, DOWN);
    const level = mean(fluid, 0);
    run(fluid, 600, [6.9, -6.9, 0]);
    expect(mean(fluid, 0)).toBeGreaterThan(level + 0.2);
  });

  it('stays finite at zero gravity and at the largest particle limit', () => {
    const weightless = new Fluid(1000);
    run(weightless, 300, [0, 0, 0], 0);
    expectFiniteAndInside(weightless);

    const large = new Fluid(20000);
    large.pour(20000);
    run(large, 150, [0, -20, 0], 1);
    run(large, 150, [14, -14, 0], 0);
    expectFiniteAndInside(large);
  }, 120_000);

  it('pours up to the limit and no further', () => {
    const fluid = new Fluid(1000);
    const initial = fluid.count;
    expect(initial).toBeLessThan(1000);
    fluid.pour(10);
    expect(fluid.count).toBe(initial + 10);
    fluid.pour(5000);
    expect(fluid.count).toBe(1000);
    run(fluid, 300, DOWN);
    expectFiniteAndInside(fluid);
  });

  it('resets to the initial block at rest', () => {
    const fluid = new Fluid(1000);
    const initial = fluid.count;
    const startHeight = mean(fluid, 1);
    fluid.pour(200);
    run(fluid, 100, DOWN);
    fluid.reset();
    expect(fluid.count).toBe(initial);
    expect(mean(fluid, 1)).toBeCloseTo(startHeight, 5);
    expect(meanSpeed(fluid)).toBe(0);
  });

  it('pushes only the particles near the ray', () => {
    const fluid = new Fluid(1000);
    run(fluid, 600, DOWN);
    fluid.push([-0.5, 1, 0], [0, -1, 0], 0.2, [0, 0, 3]);
    let near = 0;
    let far = 0;
    for (let i = 0; i < fluid.count; i++) {
      const x = fluid.positions[i * 3]!;
      const vz = fluid.velocities[i * 3 + 2]!;
      if (Math.abs(x + 0.5) < 0.1) near = Math.max(near, vz);
      if (x > 0.2) far = Math.max(far, vz);
    }
    expect(near).toBeGreaterThan(1);
    expect(far).toBeLessThan(0.5);
  });
});

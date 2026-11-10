# 3D Fluid Playground — Design

## Purpose

A public page at `/playground` in the web app where a visitor plays with simulated
liquid in a 3D glass tank. It is a sandbox for fun and experimentation and uses no
business data and no API calls.

## Decisions made with the owner

- It is a pure fluid physics sandbox, not a view of cash-flow data.
- It lives inside `apps/web` as a new route, not as a standalone file.
- The fluid is simulated on the CPU with particles and drawn with three.js, so it
  runs in every WebGL browser. WebGPU was rejected as too large a build.
- The page is public: it sits outside the `(console)` route group, so the login
  gate in the console layout does not apply.

## What the visitor can do

| Action | Control |
|---|---|
| Orbit and zoom the camera | Drag on empty space, scroll wheel |
| Tilt the tank | Two sliders, tilt X and tilt Z, each −45° to +45° |
| Shake the tank | Button: a short horizontal acceleration impulse |
| Pour more liquid | Hold a button: particles spawn at the top centre of the tank until the particle limit is reached |
| Stir | Drag inside the tank: particles near the pointer ray are pushed along the drag direction |
| Gravity | Slider, 0 to 20 m/s², default 9.8 |
| Viscosity | Slider, 0 to 1, default 0.1 |
| Particle limit | Slider, 1,000 to 8,000, default 5,000; changing it resets the tank |
| Pause / resume | Button |
| Reset | Button: refills the tank with a block of liquid at rest |

## Structure

Four units, each with one job.

### `apps/web/lib/fluid/simulation.ts`

Pure TypeScript. No three.js, no React, no DOM.

- `new Fluid(limit)` holds particle positions and velocities in `Float32Array`s,
  a live particle count, and the tank half-extents. It starts with 60% of the
  limit as a block of liquid at rest; the remainder can be poured in.
- `step(dt, gravity, viscosity)` advances one time step. `gravity` is a 3-vector
  already expressed in tank space. The solver is tuned for the exported `STEP`
  (1/60 s), which is the only step the scene uses.
- `pour(amount)` adds particles at the top centre, up to the limit.
- `push(origin, direction, radius, impulse)` adds velocity to particles near a
  ray; used for stirring.
- `reset()` restores the initial block of liquid.

Solver: particle-based viscoelastic fluid using double density relaxation
(Clavet, Beaudoin, Poulin 2005), with a uniform grid for neighbour lookup and
the tank walls enforced as position clamps with velocity damping. This method is
stable at large time steps and cheap enough for 8,000 particles on the main
thread.

The tank is always an axis-aligned box in simulation space. Tilting never moves
the box; it rotates the gravity vector instead. Shaking adds a short sideways
acceleration to that same vector while the scene slides the tank to match.

### `apps/web/components/playground/fluid-scene.tsx`

Client component owning the three.js canvas.

- Builds the scene: glass tank (transparent box with edges), lights, and one
  `InstancedMesh` of spheres for the particles, coloured by speed.
- Runs the frame loop: computes tank-space gravity from the tilt angles, calls
  `step` with a fixed time step, copies positions into the instance matrices.
- Rotates the tank group by the tilt angles so the picture matches the physics.
- Handles orbit (three.js `OrbitControls`) and stir input (raycast against the
  tank; when the pointer starts inside the tank, orbit is disabled for that drag).
- Throws if a WebGL context cannot be created. There is no 2D fallback.

Props: the parameter values, tilt angles, paused and pouring flags, a callback
reporting the particle count, and a ref handle exposing `shake` and `reset`.

### `apps/web/components/playground/controls.tsx`

The panel of sliders and buttons from the table above, built from the existing
`components/ui` primitives and Tailwind classes. Stateless: values and change
handlers come from the page.

### `apps/web/components/playground/playground.tsx`

Client component holding the parameter state and composing the scene and the controls.
The scene fills the viewport; the controls sit in a panel at the side on wide
screens and below the scene on narrow ones.

### `apps/web/app/playground/page.tsx` and `error.tsx`

The page sets the title and renders the playground. The error boundary shows a
message when the scene cannot start, for example without WebGL.

### Navigation

One `Playground` entry is added to the `NAV` list in `components/app-shell.tsx`.

## Dependencies

`three` and `@types/three` are added to `apps/web`. `vitest` is added to
`apps/web` as a dev dependency, matching the other workspaces, and the `test`
script becomes `vitest run`.

## Testing

Unit tests in `apps/web/lib/fluid/simulation.test.ts`:

- After many steps every particle is inside the tank.
- Under downward gravity the liquid settles: the mean height drops and the mean
  speed approaches zero.
- With gravity tilted toward +X the centre of mass moves to +X.
- No position or velocity is ever `NaN` or infinite, including at zero gravity
  and at maximum particle count.
- `pour` never exceeds the particle limit; `reset` restores the initial count.

Playwright test in `apps/web/e2e/anonymous.spec.ts`: `/playground` loads without
a session and shows a canvas and the controls.

## Out of scope

Smooth liquid surface rendering, refraction, multiple liquids, obstacles inside
the tank, saving or sharing setups, and touch gestures beyond what
`OrbitControls` provides. The liquid appears as many small glossy beads.

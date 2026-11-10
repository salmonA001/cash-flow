'use client';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Fluid, STEP } from '@/lib/fluid/simulation';

export interface FluidSceneHandle {
  shake(): void;
  reset(): void;
}

export interface FluidSceneProps {
  ref: Ref<FluidSceneHandle>;
  /** Maximum number of particles. Changing it rebuilds the tank. */
  limit: number;
  /** Gravity in m/s². */
  gravity: number;
  /** 0 (water) to 1 (syrup). */
  viscosity: number;
  /** Tank tilt around the X and Z axes, in degrees. */
  tiltX: number;
  tiltZ: number;
  paused: boolean;
  pouring: boolean;
  onCountChange(count: number): void;
}

const SHAKE_SECONDS = 0.6;
const SHAKE_DISTANCE = 0.08;
const SHAKE_RATE = (2 * Math.PI * 2) / SHAKE_SECONDS;
const STIR_RADIUS = 0.25;
const STIR_GAIN = 30;
const STIR_MAX_IMPULSE = 4;
/** Particle speed, in m/s, drawn in the brightest colour. */
const FAST = 3;
const SLOW_COLOUR = new THREE.Color(0x0e7490);
const FAST_COLOUR = new THREE.Color(0xcffafe);

export function FluidScene(props: FluidSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const fluidRef = useRef<Fluid | null>(null);
  const shakeStart = useRef(-Infinity);

  useImperativeHandle(props.ref, () => ({
    shake: () => {
      shakeStart.current = performance.now();
    },
    reset: () => fluidRef.current!.reset(),
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const fluid = new Fluid(props.limit);
    fluidRef.current = fluid;
    const [hx, hy, hz] = fluid.half;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(2.4, 1.7, 3.6);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    const tank = new THREE.Group();
    scene.add(tank);
    const box = new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz);
    const glass = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
    );
    const edgeGeometry = new THREE.EdgesGeometry(box);
    const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x94a3b8 }));
    tank.add(glass, edges);

    const sphere = new THREE.SphereGeometry(fluid.spacing * 0.55, 10, 7);
    const liquid = new THREE.MeshStandardMaterial({ roughness: 0.25 });
    const particles = new THREE.InstancedMesh(sphere, liquid, fluid.limit);
    particles.frustumCulled = false;
    particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(fluid.limit * 3), 3);
    const matrices = particles.instanceMatrix.array;
    const colours = particles.instanceColor.array;
    for (let i = 0; i < fluid.limit; i++) matrices[i * 16] = matrices[i * 16 + 5] = matrices[i * 16 + 10] = matrices[i * 16 + 15] = 1;
    tank.add(particles);

    // Stirring: a drag that starts on the tank pushes the liquid; any other drag orbits the camera.
    // Registered before OrbitControls so it can disable orbiting for the drag it claims.
    const tankBounds = new THREE.Box3(new THREE.Vector3(-hx, -hy, -hz), new THREE.Vector3(hx, hy, hz));
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const localRay = new THREE.Ray();
    const toLocal = new THREE.Matrix4();
    const dragPlane = new THREE.Plane();
    const dragPoint = new THREE.Vector3();
    const lastDragPoint = new THREE.Vector3();
    const impulse = new THREE.Vector3();
    let stirring = false;

    const aim = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
      raycaster.setFromCamera(pointer, camera);
      localRay.copy(raycaster.ray).applyMatrix4(toLocal.copy(tank.matrixWorld).invert());
    };
    const onPointerDown = (event: PointerEvent) => {
      aim(event);
      if (!localRay.intersectsBox(tankBounds)) return;
      stirring = true;
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(impulse), tank.position);
      raycaster.ray.intersectPlane(dragPlane, lastDragPoint);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!stirring) return;
      aim(event);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      impulse.subVectors(dragPoint, lastDragPoint).multiplyScalar(STIR_GAIN).clampLength(0, STIR_MAX_IMPULSE);
      impulse.transformDirection(toLocal).multiplyScalar(impulse.length());
      lastDragPoint.copy(dragPoint);
      fluid.push(localRay.origin.toArray(), localRay.direction.toArray(), STIR_RADIUS, impulse.toArray());
    };
    const onPointerUp = () => {
      stirring = false;
      controls.enabled = true;
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.minDistance = 2.5;
    controls.maxDistance = 9;

    const resize = new ResizeObserver(() => {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    });
    resize.observe(canvas);

    const acceleration = new THREE.Vector3();
    const upright = new THREE.Quaternion();
    const colour = new THREE.Color();
    let lastCount = -1;
    let lastTime = performance.now();
    let pending = 0;

    const frame = (now: number) => {
      const { gravity, viscosity, tiltX, tiltZ, paused, pouring, onCountChange } = live.current;
      tank.rotation.set(THREE.MathUtils.degToRad(tiltX), 0, THREE.MathUtils.degToRad(tiltZ));

      // A shake slides the tank sideways through two sine cycles; the liquid feels the opposite acceleration.
      const shakeTime = (now - shakeStart.current) / 1000;
      const shaking = shakeTime < SHAKE_SECONDS;
      const swing = shaking ? Math.sin(shakeTime * SHAKE_RATE) : 0;
      tank.position.x = SHAKE_DISTANCE * swing;
      tank.updateMatrixWorld();

      // The simulation keeps up with real time but never runs more than two steps per frame.
      pending += Math.min((now - lastTime) / 1000, 2 * STEP);
      lastTime = now;
      while (pending >= STEP) {
        pending -= STEP;
        if (paused) continue;
        if (pouring) fluid.pour(Math.ceil(fluid.limit / 600));
        acceleration.set(SHAKE_DISTANCE * SHAKE_RATE * SHAKE_RATE * swing, -gravity, 0);
        acceleration.applyQuaternion(upright.copy(tank.quaternion).invert());
        fluid.step(STEP, acceleration.toArray(), viscosity);
      }

      for (let i = 0; i < fluid.count; i++) {
        const i3 = i * 3;
        matrices[i * 16 + 12] = fluid.positions[i3]!;
        matrices[i * 16 + 13] = fluid.positions[i3 + 1]!;
        matrices[i * 16 + 14] = fluid.positions[i3 + 2]!;
        const vx = fluid.velocities[i3]!;
        const vy = fluid.velocities[i3 + 1]!;
        const vz = fluid.velocities[i3 + 2]!;
        colour.lerpColors(SLOW_COLOUR, FAST_COLOUR, Math.min(1, Math.sqrt(vx * vx + vy * vy + vz * vz) / FAST));
        colours[i3] = colour.r;
        colours[i3 + 1] = colour.g;
        colours[i3 + 2] = colour.b;
      }
      particles.count = fluid.count;
      particles.instanceMatrix.needsUpdate = true;
      particles.instanceColor!.needsUpdate = true;
      if (fluid.count !== lastCount) {
        lastCount = fluid.count;
        onCountChange(fluid.count);
      }

      controls.update();
      renderer.render(scene, camera);
      animation = requestAnimationFrame(frame);
    };
    let animation = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animation);
      resize.disconnect();
      controls.dispose();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      for (const item of [box, edgeGeometry, sphere, glass.material, edges.material, liquid, particles, renderer]) item.dispose();
    };
  }, [props.limit]);

  return <canvas ref={canvasRef} aria-label="3D liquid tank" className="block size-full touch-none" />;
}

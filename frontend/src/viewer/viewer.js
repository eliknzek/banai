// Interactive Three.js viewer. Renders ONLY from store state: it rebuilds the wardrobe
// whenever the committed design (or door visibility) changes, and never edits state
// except through store.select().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildWardrobe, disposeWardrobe } from './buildWardrobe.js';
import { TRANSITION_MS, cameraPose, easeInOutCubic, interpolatePose } from './cameraViews.js';
import { frameOf } from './builders/frame.js';
import { createDimensions } from './dimensions.js';
import { createHighlighter } from './highlight.js';
import { createMaterials } from './materials.js';
import { attachPicking } from './picking.js';
import { describeSelection } from './format.js';
import { resolveSelection } from '../state/store.js';

const BACKGROUND = '#eceeec';
// Scene colours that follow the UI theme, read from CSS custom properties (styles/tokens.css).
const THEME_COLORS = {
  background: ['--md-sys-color-viewer', BACKGROUND],
  grid: ['--theme-viewer-grid', '#c9ccc8'],
  gridMinor: ['--theme-viewer-grid-minor', '#dcdfdb'],
  highlight: ['--theme-viewer-highlight', '#c2410c'],
  dimension: ['--theme-viewer-dimension', '#5b6470'],
};
// Showcase turntable: OrbitControls turns 60 / speed seconds per orbit, so 0.75 is one turn in 80 s.
const AUTO_ROTATE_SPEED = 0.75;
// Components that get a hover tooltip, and its offset from the pointer (above-right, clear of the cursor).
const TOOLTIP_KINDS = new Set(['shelf', 'drawer', 'compartment']);
const TOOLTIP_OFFSET_PX = 14;

const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9c4b8', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#ffffff', 0.9);
  fill.position.set(-2, 2, 5);
  scene.add(fill);
  scene.add(createGrid(THEME_COLORS.grid[1], THEME_COLORS.gridMinor[1]));
  return scene;
}

function createGrid(color, minorColor) {
  const grid = new THREE.GridHelper(12, 24, color, minorColor);
  grid.name = 'grid';
  grid.position.y = -0.0005;
  return grid;
}

/** Map a raycast hit to a selectable component id (the back panel selects its compartment). */
function componentAt(hit, design) {
  if (!hit) return null;
  const { componentId, part } = hit.object.userData;
  if (part !== 'back') return componentId;
  const frame = frameOf(design);
  const xMm = hit.point.x * 1000;
  const index = frame.ranges.findIndex(([x0, x1]) => xMm >= x0 && xMm <= x1);
  return index >= 0 ? design.compartments[index].id : componentId;
}

export function createViewer(container, store, { onAutoRotateChange = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '3D wardrobe view. Every part is also listed under All parts in the Properties panel.');
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'viewer-labels';
  container.appendChild(labels.domElement);

  const scene = createScene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, minDistance: 0.6, maxDistance: 14, maxPolarAngle: Math.PI / 2 - 0.02 });

  const materials = createMaterials(store.getState().catalog);
  const highlighter = createHighlighter(scene);
  const dimensions = createDimensions(scene);
  let group = null;
  let rendered = { design: null, doorsVisible: null, selection: undefined, dimsKey: null };

  /** Re-read the theme's scene colours (call after the UI theme changes). */
  const applyTheme = () => {
    const style = getComputedStyle(container);
    const read = ([property, fallback]) => style.getPropertyValue(property).trim() || fallback;
    scene.background.set(read(THEME_COLORS.background));
    const oldGrid = scene.getObjectByName('grid');
    scene.remove(oldGrid);
    oldGrid.dispose();
    scene.add(createGrid(read(THEME_COLORS.grid), read(THEME_COLORS.gridMinor)));
    highlighter.setColor(read(THEME_COLORS.highlight));
    dimensions.setColor(read(THEME_COLORS.dimension));
  };
  applyTheme();

  // Camera presets move only the camera: the design and the store are never touched.
  let flight = null; // { from, to, start } while easing to a preset view
  const currentPose = () => ({ position: camera.position.toArray(), target: controls.target.toArray() });
  const placeCamera = ({ position, target }) => {
    camera.position.fromArray(position);
    controls.target.fromArray(target);
  };
  const stepFlight = (now) => {
    if (!flight) return;
    const t = Math.min(1, Math.max(0, (now - flight.start) / TRANSITION_MS));
    placeCamera(interpolatePose(flight.from, flight.to, easeInOutCubic(t)));
    if (t === 1) flight = null;
  };
  // Showcase turntable around the current target. Off by default; never runs under reduced motion.
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  const setAutoRotate = (on) => {
    const next = Boolean(on) && !prefersReducedMotion();
    if (next === controls.autoRotate) return;
    controls.autoRotate = next;
    onAutoRotateChange(next);
  };
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onReducedMotionChange = () => { if (prefersReducedMotion()) setAutoRotate(false); };
  reducedMotionQuery?.addEventListener('change', onReducedMotionChange);

  // Grabbing the view (drag, zoom, touch) hands control back to the user immediately.
  controls.addEventListener('start', () => {
    flight = null;
    setAutoRotate(false);
  });

  const fitCamera = (design) => {
    flight = null;
    placeCamera(cameraPose('reset', design.dimensions, camera.fov));
    controls.update();
  };

  // Drops the damping inertia left by a drag, which would otherwise keep turning the camera after a
  // preset lands. An undamped update() clears it; restoring the pose cancels its one-off nudge.
  const stopMomentum = () => {
    const pose = currentPose();
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    placeCamera(pose);
  };

  const setView = (view) => {
    hideTooltip();
    setAutoRotate(false);
    stopMomentum();
    const to = cameraPose(view, store.getState().design.dimensions, camera.fov);
    if (prefersReducedMotion()) {
      flight = null;
      placeCamera(to);
      controls.update();
      return;
    }
    flight = { from: currentPose(), to, start: performance.now() };
  };

  const sync = (state) => {
    const { design, ui, selection } = state;
    const geometryChanged = design !== rendered.design || ui.doorsVisible !== rendered.doorsVisible;
    if (geometryChanged) {
      if (group) {
        scene.remove(group);
        disposeWardrobe(group);
      }
      group = buildWardrobe(design, materials, { doorsVisible: ui.doorsVisible });
      scene.add(group);
      materials.retainOnly(new Set(group.children.map((mesh) => mesh.material)));
      const { width, height, depth } = design.dimensions;
      const dimsKey = `${width}x${height}x${depth}`;
      if (dimsKey !== rendered.dimsKey) fitCamera(design);
      rendered = { ...rendered, design, doorsVisible: ui.doorsVisible, dimsKey };
    }
    if (geometryChanged || selection !== rendered.selection) {
      highlighter.update(group, design, selection);
      dimensions.update(group, design, selection);
      rendered = { ...rendered, selection };
    }
  };

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    renderer.setSize(clientWidth, clientHeight);
    labels.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / Math.max(clientHeight, 1);
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // Hover tooltip: a short description of the shelf, drawer or compartment under the pointer.
  const tooltip = document.createElement('div');
  tooltip.className = 'dim-label viewer-tooltip';
  tooltip.setAttribute('aria-hidden', 'true'); // the canvas is one image; parts are listed in Properties
  tooltip.hidden = true;
  container.appendChild(tooltip);
  const hideTooltip = () => { tooltip.hidden = true; };
  const showTooltip = (hit, event) => {
    const { design } = store.getState();
    const id = componentAt(hit, design);
    const selection = id ? resolveSelection(design, id) : null;
    if (!selection || !TOOLTIP_KINDS.has(selection.kind)) return hideTooltip();
    tooltip.textContent = describeSelection(design, selection);
    tooltip.hidden = false;
    // Sit above-right of the pointer; flip to the other side near the container's edges.
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { offsetWidth: w, offsetHeight: h } = tooltip;
    const left = x + TOOLTIP_OFFSET_PX + w <= rect.width ? x + TOOLTIP_OFFSET_PX : x - TOOLTIP_OFFSET_PX - w;
    const top = y - TOOLTIP_OFFSET_PX - h >= 0 ? y - TOOLTIP_OFFSET_PX - h : y + TOOLTIP_OFFSET_PX * 2;
    tooltip.style.transform = `translate(${Math.max(0, left)}px, ${top}px)`;
  };
  // An orbit drag or a camera preset moves the scene under a still pointer: drop the stale tooltip.
  controls.addEventListener('start', hideTooltip);

  const detachPicking = attachPicking({
    dom: renderer.domElement,
    camera,
    getTargets: () => (group ? group.children : []),
    onPick: (hit) => store.select(componentAt(hit, store.getState().design)),
    onHover: (hit, event) => {
      renderer.domElement.style.cursor = hit?.object.userData.componentId ? 'pointer' : '';
      showTooltip(hit, event);
    },
  });
  const unsubscribe = store.subscribe(sync);
  sync(store.getState());

  // Frame time (s) for controls.update(), so auto-rotation keeps one speed at any refresh rate.
  // Capped so a frame after a backgrounded tab doesn't jump the turntable.
  let lastFrame = null;
  renderer.setAnimationLoop((now) => {
    const delta = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    stepFlight(now);
    controls.update(delta);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return {
    camera,
    controls,
    canvas: renderer.domElement,
    /** Move the camera to a preset view: 'front', 'side', 'threeQuarter' or 'reset'. */
    setView,
    /** Re-read the scene colours from the current UI theme. */
    applyTheme,
    /** Start or stop the slow showcase rotation. Ignored (stays off) under prefers-reduced-motion. */
    setAutoRotate,
    get autoRotating() { return controls.autoRotate; },
    meshOf: (componentId) => group?.children.find((mesh) => mesh.userData.componentId === componentId) ?? null,
    /** Client (page) coordinates of a component's centre, for tests and tooling. */
    screenPointOf(componentId) {
      const mesh = this.meshOf(componentId);
      if (!mesh) return null;
      const projected = mesh.position.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - projected.y) / 2) * rect.height };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      reducedMotionQuery?.removeEventListener('change', onReducedMotionChange);
      unsubscribe();
      detachPicking();
      resizeObserver.disconnect();
      if (group) disposeWardrobe(group);
      highlighter.dispose();
      dimensions.dispose();
      materials.dispose();
      controls.dispose();
      renderer.dispose();
    },
  };
}

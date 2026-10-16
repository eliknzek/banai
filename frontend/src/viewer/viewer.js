// Interactive Three.js viewer. Renders ONLY from store state: it rebuilds the wardrobe
// whenever the committed design (or door visibility) changes, and never edits state
// except through store.select().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { onLocaleChange, t } from '../i18n/index.js';
import { buildWardrobe, disposeWardrobe } from './buildWardrobe.js';
import { frameOf } from './builders/frame.js';
import { createDimensions } from './dimensions.js';
import { createHighlighter } from './highlight.js';
import { createMaterials } from './materials.js';
import { attachPicking } from './picking.js';
import { toM } from './units.js';

const BACKGROUND = '#eceeec';

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
  const grid = new THREE.GridHelper(12, 24, '#c9ccc8', '#dcdfdb');
  grid.name = 'grid';
  grid.position.y = -0.0005;
  scene.add(grid);
  return scene;
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

// The photoreal render's reference: a plain light studio background.
const CAPTURE_BACKGROUND = '#f5f4f1';

// Horizontal room kept for the height/depth labels on both sides of the wardrobe.
const LABEL_MARGIN_MM = 800;

export function createViewer(container, store) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const labelCanvas = () => renderer.domElement.setAttribute('aria-label', t('aria.viewer'));
  labelCanvas();
  onLocaleChange(labelCanvas);
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'viewer-labels';
  // CSS2D positions labels from the top-left corner; in a right-to-left page an absolutely
  // positioned label would start at the right edge instead. Each label sets its own text direction.
  labels.domElement.dir = 'ltr';
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

  const fitCamera = (design) => {
    const { width, height, depth } = design.dimensions;
    const center = new THREE.Vector3(toM(width / 2), toM(height / 2), toM(-depth / 2));
    // Fit both the height and the width (plus room for the side dimension labels) to the canvas,
    // so the labels stay visible in a narrow viewer and with the wider Hebrew wording.
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitHeight = toM(height) / 2 / halfTan;
    const fitWidth = toM(width + LABEL_MARGIN_MM) / 2 / (halfTan * Math.max(camera.aspect, 0.1));
    const distance = Math.max(fitHeight, fitWidth) * 1.2;
    camera.position.set(center.x + distance * 0.35, center.y + distance * 0.12, distance);
    controls.target.copy(center);
    controls.update();
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

  const detachPicking = attachPicking({
    dom: renderer.domElement,
    camera,
    getTargets: () => (group ? group.children : []),
    onPick: (hit) => store.select(componentAt(hit, store.getState().design)),
    onHover: (hit) => { renderer.domElement.style.cursor = hit?.object.userData.componentId ? 'pointer' : ''; },
  });
  const unsubscribe = store.subscribe(sync);
  sync(store.getState());

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return {
    camera,
    controls,
    canvas: renderer.domElement,
    meshOf: (componentId) => group?.children.find((mesh) => mesh.userData.componentId === componentId) ?? null,
    /**
     * A clean PNG of the current view for the photoreal render: white background, no grid, no
     * selection outline (dimension labels are DOM, not in the canvas). The scene is restored at once.
     */
    capture() {
      const grid = scene.getObjectByName('grid');
      const highlight = scene.getObjectByName('highlight');
      const background = scene.background;
      const shown = [grid?.visible, highlight?.visible];
      if (grid) grid.visible = false;
      if (highlight) highlight.visible = false;
      scene.background = new THREE.Color(CAPTURE_BACKGROUND);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      if (grid) grid.visible = shown[0];
      if (highlight) highlight.visible = shown[1];
      scene.background = background;
      renderer.render(scene, camera);
      return url.slice(url.indexOf(',') + 1); // base64 PNG
    },
    /** Re-draw the dimension labels, e.g. after the interface language changed. */
    refreshLabels() {
      const { design, selection } = store.getState();
      dimensions.update(group, design, selection);
    },
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

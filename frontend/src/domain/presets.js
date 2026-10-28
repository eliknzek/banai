// Predefined starting designs. Mirrors BASIC_WARDROBE_OPS / basic_wardrobe in
// backend/app/domain/defaults.py (configurable prototype values).

import { applyOps } from './apply.js';
import { deepFreeze } from './util.js';

export const BASIC_WARDROBE_OPS = deepFreeze([
  { op: 'create_wardrobe', width: 2000, height: 2400, depth: 600, compartmentCount: 3,
    compartmentIds: ['cmp_left', 'cmp_middle', 'cmp_right'], partitionIds: ['prt_1', 'prt_2'] },
  { op: 'add_shelf', compartmentId: 'cmp_left', y: 400, id: 'shf_l1' },
  { op: 'add_shelf', compartmentId: 'cmp_left', y: 800, id: 'shf_l2' },
  { op: 'add_shelf', compartmentId: 'cmp_left', y: 1200, id: 'shf_l3' },
  { op: 'add_shelf', compartmentId: 'cmp_left', y: 1600, id: 'shf_l4' },
  { op: 'add_shelf', compartmentId: 'cmp_middle', y: 2000, id: 'shf_m1' },
  { op: 'add_rail', compartmentId: 'cmp_middle', y: 1900, id: 'rail_m1' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 800, id: 'shf_r1' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 1400, id: 'shf_r2' },
  { op: 'add_drawer', compartmentId: 'cmp_right', y: 0, height: 200, id: 'drw_r1' },
  { op: 'add_drawer', compartmentId: 'cmp_right', y: 200, height: 200, id: 'drw_r2' },
  { op: 'configure_doors', type: 'hinged', ids: ['dr_left', 'dr_middle', 'dr_right'] },
]);

/** The predefined starting wardrobe (entry option 3), built through the op protocol. */
export const basicWardrobe = (catalog) => applyOps(null, BASIC_WARDROBE_OPS, catalog);

// Extra starting templates, offered on the start screen next to the basic wardrobe. Example layouts
// (configurable defaults, not recommendations); every id is explicit so the result is deterministic.

/** Kids' wardrobe, 150 cm high: a low hanging rail on the left, shelves and drawers on the right. */
export const KIDS_WARDROBE_OPS = deepFreeze([
  { op: 'create_wardrobe', width: 1000, height: 1500, depth: 500, compartmentCount: 2,
    compartmentIds: ['cmp_left', 'cmp_right'], partitionIds: ['prt_1'] },
  { op: 'add_rail', compartmentId: 'cmp_left', y: 1150, id: 'rail_l1' },
  { op: 'add_shelf', compartmentId: 'cmp_left', y: 1250, id: 'shf_l1' },
  { op: 'add_drawer', compartmentId: 'cmp_right', y: 0, height: 180, id: 'drw_r1' },
  { op: 'add_drawer', compartmentId: 'cmp_right', y: 180, height: 180, id: 'drw_r2' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 600, id: 'shf_r1' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 900, id: 'shf_r2' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 1200, id: 'shf_r3' },
  { op: 'configure_doors', type: 'hinged', ids: ['dr_left', 'dr_right'] },
  { op: 'set_material', target: 'doors', color: { catalogId: 'olive_green' }, finish: { catalogId: 'satin' } },
]);

/** Double wardrobe with two sliding doors: hanging at both ends, shelves and drawers in the middle. */
export const DOUBLE_SLIDING_WARDROBE_OPS = deepFreeze([
  { op: 'create_wardrobe', width: 2400, height: 2400, depth: 650, compartmentCount: 4,
    compartmentIds: ['cmp_a', 'cmp_b', 'cmp_c', 'cmp_d'], partitionIds: ['prt_1', 'prt_2', 'prt_3'] },
  { op: 'add_rail', compartmentId: 'cmp_a', y: 1900, id: 'rail_a1' },
  { op: 'add_shelf', compartmentId: 'cmp_a', y: 2000, id: 'shf_a1' },
  { op: 'add_shelf', compartmentId: 'cmp_b', y: 400, id: 'shf_b1' },
  { op: 'add_shelf', compartmentId: 'cmp_b', y: 800, id: 'shf_b2' },
  { op: 'add_shelf', compartmentId: 'cmp_b', y: 1200, id: 'shf_b3' },
  { op: 'add_shelf', compartmentId: 'cmp_b', y: 1600, id: 'shf_b4' },
  { op: 'add_shelf', compartmentId: 'cmp_b', y: 2000, id: 'shf_b5' },
  { op: 'add_drawer', compartmentId: 'cmp_c', y: 0, height: 200, id: 'drw_c1' },
  { op: 'add_drawer', compartmentId: 'cmp_c', y: 200, height: 200, id: 'drw_c2' },
  { op: 'add_drawer', compartmentId: 'cmp_c', y: 400, height: 200, id: 'drw_c3' },
  { op: 'add_shelf', compartmentId: 'cmp_c', y: 1000, id: 'shf_c1' },
  { op: 'add_shelf', compartmentId: 'cmp_c', y: 1500, id: 'shf_c2' },
  { op: 'add_shelf', compartmentId: 'cmp_c', y: 2000, id: 'shf_c3' },
  { op: 'add_rail', compartmentId: 'cmp_d', y: 1900, id: 'rail_d1' },
  { op: 'add_shelf', compartmentId: 'cmp_d', y: 2000, id: 'shf_d1' },
  { op: 'configure_doors', type: 'sliding', ids: ['dr_left', 'dr_right'] },
  { op: 'set_material', target: 'doors', material: { catalogId: 'oak_veneer' }, color: { catalogId: 'natural_oak' } },
]);

/** Minimalist wardrobe: two compartments, few parts, white lacquered MDF throughout. */
export const MINIMALIST_WARDROBE_OPS = deepFreeze([
  { op: 'create_wardrobe', width: 1800, height: 2200, depth: 600, compartmentCount: 2,
    compartmentIds: ['cmp_left', 'cmp_right'], partitionIds: ['prt_1'] },
  { op: 'add_rail', compartmentId: 'cmp_left', y: 1800, id: 'rail_l1' },
  { op: 'add_shelf', compartmentId: 'cmp_left', y: 1900, id: 'shf_l1' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 500, id: 'shf_r1' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 1000, id: 'shf_r2' },
  { op: 'add_shelf', compartmentId: 'cmp_right', y: 1500, id: 'shf_r3' },
  { op: 'configure_doors', type: 'hinged', ids: ['dr_left', 'dr_right'] },
  { op: 'set_material', target: 'carcass', material: { catalogId: 'lacquered_mdf' } },
  { op: 'set_material', target: 'doors', material: { catalogId: 'lacquered_mdf' } },
]);

/** Start-screen templates. `id` names the shared fixture (shared/fixtures/designs/<id>.json). */
export const TEMPLATES = deepFreeze([
  { id: 'kids', title: "Kids' wardrobe", description: '100 × 150 × 50 cm · low hanging rail, shelves and drawers', ops: KIDS_WARDROBE_OPS },
  { id: 'double_sliding', title: 'Double wardrobe, sliding doors', description: '240 × 240 × 65 cm · two sliding doors, hanging at both ends', ops: DOUBLE_SLIDING_WARDROBE_OPS },
  { id: 'minimalist', title: 'Minimalist wardrobe', description: '180 × 220 × 60 cm · white lacquer, a rail and three shelves', ops: MINIMALIST_WARDROBE_OPS },
]);

/** Build a template's design through the op protocol (validated like any other design). */
export function templateDesign(id, catalog) {
  const template = TEMPLATES.find((entry) => entry.id === id);
  if (!template) throw new Error(`unknown template: ${id}`);
  return applyOps(null, template.ops, catalog);
}

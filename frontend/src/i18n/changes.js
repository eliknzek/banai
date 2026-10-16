// Proposal card rows in the interface language. The server sends each row as a stable `key`
// with raw `params` (lengths in mm, 1-based indexes from the left with their `count`, catalog ids) plus an English title/detail,
// which is used as is for unknown keys. Nothing here trusts the params beyond formatting them.
import { catalogName, formatCm, spatialNumber, t } from './index.js';

const SECTION_BY_FIELD = Object.freeze({ material: 'materials', color: 'colors', finish: 'finishes' });
const ITEM_KINDS = new Set(['shelf', 'drawer', 'rail']);
const INDEXED_KINDS = new Set(['compartment', 'partition', 'door']);
const isNumber = (value) => Number.isFinite(value);

export function refText(ref) {
  if (!ref || typeof ref !== 'object') return t('ref.component');
  if (ref.kind === 'compartment' && !isNumber(ref.index)) return t('ref.newCompartment');
  if (ref.kind === 'compartment') return t('ref.compartment', { i: spatialNumber(ref.index, ref.count) });
  if (ITEM_KINDS.has(ref.kind) && isNumber(ref.compartment)) return t('ref.item', { kind: t(`kind.${ref.kind}`), c: spatialNumber(ref.compartment, ref.compartments) });
  if (INDEXED_KINDS.has(ref.kind) && isNumber(ref.index)) return t('ref.indexed', { kind: t(`kind.${ref.kind}`), i: spatialNumber(ref.index, ref.count) });
  return t('ref.component');
}

const sizes = (params, pairs) => pairs.filter(([name]) => isNumber(params[name]))
  .map(([name, key]) => t(key, { v: formatCm(params[name]) }));

function targetText(target) {
  if (target?.kind === 'carcass') return t('change.carcass');
  if (target?.kind === 'doors') return t('change.allDoors');
  return refText(target);
}

function valueText(value) {
  if (typeof value?.custom === 'string') return value.custom; // a customer's own colour name
  const section = SECTION_BY_FIELD[value?.field];
  return section && typeof value.catalogId === 'string' ? catalogName(section, { id: value.catalogId, name: value.catalogId }) : '';
}

const RENDERERS = {
  create: (p) => [t('change.create'), t('change.createDetail', { w: formatCm(p.width), h: formatCm(p.height), d: formatCm(p.depth), n: p.count })],
  dimensions: (p) => [t('change.dimensions'), sizes(p, [['width', 'change.width'], ['height', 'change.height'], ['depth', 'change.depth']]).join(' · ') || t('change.unchanged')],
  doors: (p) => [t('change.doors'), { none: t('change.doorsNone'), sliding: t('change.doorsSliding', { n: p.count }), hinged: t('change.doorsHinged', { n: p.count }) }[p.type]],
  compartmentAdded: (p) => [t('change.compartmentAdded'), t('change.compartmentAddedDetail', { p: spatialNumber(p.position, p.count), w: formatCm(p.width) })],
  compartmentWidth: (p) => [refText(p.ref), t('change.width', { v: formatCm(p.width) })],
  partitionAdded: (p) => [t('change.partitionAdded'), t('change.partitionAddedDetail', { ref: refText(p.ref), offset: formatCm(p.offset) })],
  partition: (p) => [refText(p.ref), sizes(p, [['position', 'change.position'], ['thickness', 'change.thickness']]).join(', ') || t('change.unchanged')],
  shelfAdded: (p) => [t('change.shelfAdded'), t('change.addedAt', { ref: refText(p.ref), y: formatCm(p.y) })],
  drawerAdded: (p) => [t('change.drawerAdded'), t('change.drawerAddedDetail', { ref: refText(p.ref), y: formatCm(p.y), h: formatCm(p.height) })],
  railAdded: (p) => [t('change.railAdded'), t('change.addedAt', { ref: refText(p.ref), y: formatCm(p.y) })],
  item: (p) => [refText(p.ref), sizes(p, [['y', 'change.at'], ['height', 'change.itemHeight'], ['thickness', 'change.thickness']]).join(', ') || t('change.unchanged')],
  material: (p) => [targetText(p.target), (Array.isArray(p.values) ? p.values : []).map(valueText).filter(Boolean).join(', ')],
  materialCleared: (p) => [targetText(p.target), t('change.materialCleared')],
  removed: (p) => [t('change.removed'), refText(p.ref)],
  compartments: (p) => [t('change.compartments'), `${(Array.isArray(p.widths) ? p.widths : []).filter(isNumber).map((w) => (w / 10).toFixed(1)).join(' · ')} ${t('unit.cm')}`],
  narrow: (p) => [t('change.narrow'), t('change.narrowDetail', { i: spatialNumber(p.index, p.count), w: formatCm(p.width) })],
};

// The widths list follows the wardrobe left to right, so it reads left to right in every
// language (in Hebrew, compartment 1 would otherwise appear at the right end of the line).
const SPATIAL_KEYS = new Set(['compartments']);

/** { title, detail, detailDir } for a card row in the current language. */
export function changeText(change) {
  const render = typeof change?.key === 'string' && Object.hasOwn(RENDERERS, change.key) ? RENDERERS[change.key] : null;
  if (!render || !change.params || typeof change.params !== 'object') return { title: change.title, detail: change.detail };
  try {
    const [title, detail] = render(change.params);
    const text = { title: title || change.title, detail: detail ?? change.detail };
    return SPATIAL_KEYS.has(change.key) ? { ...text, detailDir: 'ltr' } : text;
  } catch {
    return { title: change.title, detail: change.detail };
  }
}

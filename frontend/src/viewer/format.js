// Display formatting. The domain is integer mm; the UI shows centimetres (1 decimal), with the
// unit and wording of the interface language.
import { formatCm, t } from '../i18n/index.js';

export const cm = (mm) => (mm / 10).toFixed(1);

/** One-line description of a selected component, for labels and readouts. */
export function describeSelection(design, selection) {
  if (!selection) return '';
  const { id, kind } = selection;
  const { width, height, depth } = design.dimensions;
  if (kind === 'carcass') return t('sel.carcass', { w: cm(width), h: cm(height), d: cm(depth), unit: t('unit.cm') });
  for (const [ci, compartment] of design.compartments.entries()) {
    if (compartment.id === id) return t('sel.compartment', { i: ci + 1, w: formatCm(compartment.width) });
    const shelf = compartment.shelves.find((s) => s.id === id);
    if (shelf) return t('sel.shelf', { y: formatCm(shelf.y), t: formatCm(shelf.thickness) });
    const drawer = compartment.drawers.find((d) => d.id === id);
    if (drawer) return t('sel.drawer', { y: formatCm(drawer.y), h: formatCm(drawer.height) });
    const rail = compartment.rails.find((r) => r.id === id);
    if (rail) return t('sel.rail', { y: formatCm(rail.y) });
  }
  const pi = design.partitions.findIndex((p) => p.id === id);
  if (pi >= 0) return t('sel.partition', { i: pi + 1, t: formatCm(design.partitions[pi].thickness) });
  const door = design.doors.items.find((d) => d.id === id);
  if (door) {
    const name = t(design.doors.type === 'sliding' ? 'sel.doorSliding' : 'sel.doorHinged');
    return door.hingeSide ? t('sel.hinge', { door: name, side: t(`sideLower.${door.hingeSide}`) }) : name;
  }
  return kind;
}

// Always-visible wardrobe settings: overall dimensions, doors and main materials.
// Inputs report their own errors inline; buttons/selects report under their section.
import { appearanceControls } from './appearanceControls.js';
import { actionResult, cmField, countField, el, section, segmented } from './fields.js';
import { dimensionOps, doorTypeOps } from './opsFromForm.js';
import { t } from '../i18n/index.js';

function dimensionsRow(design, run) {
  const { width, height, depth } = design.dimensions;
  return el('div', { className: 'field-row field-row--3' }, [
    cmField({ label: t('field.width'), mm: width, testId: 'dim-width', onCommit: (mm) => run(dimensionOps('width', mm)) }),
    cmField({ label: t('field.height'), mm: height, testId: 'dim-height', onCommit: (mm) => run(dimensionOps('height', mm)) }),
    cmField({ label: t('field.depth'), mm: depth, testId: 'dim-depth', onCommit: (mm) => run(dimensionOps('depth', mm)) }),
  ]);
}

export function wardrobeSection({ design, catalog, run }) {
  const { doors } = design;
  const wardrobe = section(t('section.wardrobe'), [dimensionsRow(design, run)]);
  const runDoors = (ops) => actionResult(wardrobe, run(ops));
  wardrobe.append(segmented({
    label: t('field.doors'),
    testId: 'door-type',
    value: doors.type,
    options: ['hinged', 'sliding', 'none'].map((value) => ({ value, label: t(`door.${value}`) })),
    onChange: (type) => runDoors(doorTypeOps(type)),
  }));
  if (doors.type === 'sliding') {
    wardrobe.append(countField({
      label: t('field.slidingPanels'), value: doors.items.length, testId: 'sliding-count',
      onCommit: (count) => run(doorTypeOps('sliding', count)),
    }));
  }

  const materials = section(t('section.materials'), []);
  const runMaterials = (ops) => actionResult(materials, run(ops));
  materials.append(appearanceControls({ catalog, appearance: design.carcass.appearance, target: 'carcass', run: runMaterials, label: t('appearance.carcass') }));
  if (doors.type !== 'none') {
    materials.append(appearanceControls({ catalog, appearance: doors.appearance, target: 'doors', run: runMaterials, label: t('appearance.doors') }));
  }
  return [wardrobe, materials];
}

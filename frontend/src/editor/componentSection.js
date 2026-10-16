// Properties of the selected component; only the fields that apply to its kind.
import { appearanceControls } from './appearanceControls.js';
import { actionResult, button, cmField, el, section, segmented } from './fields.js';
import { addItemOps, clearAppearanceOps, doorHingeOps, removeOps } from './opsFromForm.js';
import { partitionLeftEdge } from '../domain/geometry.js';
import { t } from '../i18n/index.js';


function findItem(design, kind, id) {
  const key = { shelf: 'shelves', drawer: 'drawers', rail: 'rails' }[kind];
  for (const compartment of design.compartments) {
    const item = compartment[key]?.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  return null;
}

function overrideControls({ catalog, item, inherited, run, label, inheritFrom }) {
  const appearance = item.appearance ?? inherited;
  const useInherited = t(inheritFrom === 'doors' ? 'appearance.useDoor' : 'appearance.useCarcass');
  return [
    appearanceControls({ catalog, appearance, target: item.id, run, label }),
    ...(item.appearance ? [button(useInherited, () => run(clearAppearanceOps(item.id)), { variant: 'ghost' })] : []),
  ];
}

function fieldsFor(kind, { design, catalog, selection, run, runAction }) {
  const { id } = selection;
  const move = (op, field) => (mm) => run([{ op, id, [field]: mm }]);
  if (kind === 'shelf') {
    const shelf = findItem(design, kind, id);
    return [
      cmField({ label: t('field.heightFromBase'), mm: shelf.y, testId: 'shelf-y', onCommit: move('modify_shelf', 'y') }),
      cmField({ label: t('field.thickness'), mm: shelf.thickness, testId: 'shelf-thickness', onCommit: move('modify_shelf', 'thickness') }),
      ...overrideControls({ catalog, item: shelf, inherited: design.carcass.appearance, run: runAction, label: t('appearance.shelf'), inheritFrom: 'carcass' }),
    ];
  }
  if (kind === 'drawer') {
    const drawer = findItem(design, kind, id);
    return [
      cmField({ label: t('field.heightFromBase'), mm: drawer.y, testId: 'drawer-y', onCommit: move('modify_drawer', 'y') }),
      cmField({ label: t('field.drawerHeight'), mm: drawer.height, testId: 'drawer-height', onCommit: move('modify_drawer', 'height') }),
      ...overrideControls({ catalog, item: drawer, inherited: design.carcass.appearance, run: runAction, label: t('appearance.drawer'), inheritFrom: 'carcass' }),
    ];
  }
  if (kind === 'rail') {
    const rail = findItem(design, kind, id);
    return [cmField({ label: t('field.heightFromBase'), mm: rail.y, testId: 'rail-y', onCommit: move('modify_rail', 'y') })];
  }
  if (kind === 'compartment') {
    const compartment = design.compartments.find((c) => c.id === id);
    return [
      cmField({ label: t('field.width'), mm: compartment.width, testId: 'compartment-width', onCommit: (mm) => run([{ op: 'modify_compartment', compartmentId: id, width: mm }]) }),
      el('div', { className: 'button-row' }, ['shelf', 'drawer', 'rail'].map((item) =>
        button(t(`add.${item}`), () => runAction(addItemOps(design, id, item)), { testId: `add-${item}` }))),
    ];
  }
  if (kind === 'partition') {
    const index = design.partitions.findIndex((p) => p.id === id);
    return [
      cmField({ label: t('field.positionFromLeft'), mm: partitionLeftEdge(design, index), testId: 'partition-position', onCommit: (mm) => run([{ op: 'modify_partition', partitionId: id, position: mm }]) }),
      cmField({ label: t('field.thickness'), mm: design.partitions[index].thickness, testId: 'partition-thickness', onCommit: (mm) => run([{ op: 'modify_partition', partitionId: id, thickness: mm }]) }),
    ];
  }
  if (kind === 'door') {
    const door = design.doors.items.find((d) => d.id === id);
    return [
      ...(design.doors.type === 'hinged' ? [segmented({
        label: t('field.hingeSide'), value: door.hingeSide, testId: 'hinge-side',
        options: ['left', 'right'].map((value) => ({ value, label: t(`side.${value}`) })),
        onChange: (side) => runAction(doorHingeOps(design, id, side)),
      })] : []),
      ...overrideControls({ catalog, item: door, inherited: design.doors.appearance, run: runAction, label: t('appearance.door'), inheritFrom: 'doors' }),
    ];
  }
  return [el('p', { className: 'panel__note', text: t('carcass.note') })];
}

export function componentSection({ design, catalog, selection, run, select }) {
  const container = section(t('selected.title', { kind: t(`kind.${selection.kind}`) }), []);
  container.dataset.testid = 'selected-section';
  // Inputs report their own errors inline; buttons/selects report under the section.
  const runAction = (ops) => actionResult(container, run(ops));
  container.append(...fieldsFor(selection.kind, { design, catalog, selection, run, runAction }));
  const actions = [button(t('action.deselect'), () => select(null), { variant: 'ghost' })];
  if (selection.kind !== 'carcass') {
    actions.unshift(button(t('action.delete', { kind: t(`kindLower.${selection.kind}`) }), () => runAction(removeOps(selection.id)), { variant: 'danger', testId: 'delete-selected' }));
  }
  container.append(el('div', { className: 'button-row' }, actions));
  return container;
}

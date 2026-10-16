import { afterEach, describe, expect, it } from 'vitest';
import { resetLocaleForTests, spatialNumber } from '../../../src/i18n/index.js';
import { changeText } from '../../../src/i18n/changes.js';
import { describeSelection } from '../../../src/viewer/format.js';
import { loadDesign } from '../domain/helpers.js';

afterEach(() => resetLocaleForTests('en'));

describe('numbering of side-by-side parts', () => {
  it('counts from the left in English and from the right in Hebrew', () => {
    expect([1, 2, 3].map((i) => spatialNumber(i, 3))).toEqual([1, 2, 3]);
    resetLocaleForTests('he');
    expect([1, 2, 3].map((i) => spatialNumber(i, 3))).toEqual([3, 2, 1]);
  });

  it('shows the index as sent when the count is missing or does not fit', () => {
    resetLocaleForTests('he');
    expect(spatialNumber(2, undefined)).toBe(2);
    expect(spatialNumber(5, 3)).toBe(5);
    expect(spatialNumber('2', 3)).toBe('2');
  });

  const rows = [
    [{ key: 'shelfAdded', params: { ref: { kind: 'compartment', index: 3, count: 3 }, y: 1000 } }, 'Compartment 3, at 100.0 cm', 'תא 1, בגובה 100.0 ס״מ'],
    [{ key: 'removed', params: { ref: { kind: 'shelf', compartment: 1, compartments: 3 } } }, 'Shelf in compartment 1', 'מדף בתא 3'],
    [{ key: 'removed', params: { ref: { kind: 'door', index: 1, count: 3 } } }, 'Door 1', 'דלת 3'],
    [{ key: 'removed', params: { ref: { kind: 'partition', index: 2, count: 2 } } }, 'Partition 2', 'מחיצה 1'],
    [{ key: 'narrow', params: { index: 3, count: 4, width: 143 } }, 'Compartment 3: 14.3 cm', 'תא 2: 14.3 ס״מ'],
    [{ key: 'compartmentAdded', params: { position: 4, count: 4, width: 500 } }, 'Position 4, width 50.0 cm', 'מקום 1, רוחב 50.0 ס״מ'],
  ];

  it.each(rows)('card row %o is numbered from the right in Hebrew only', (change, english, hebrew) => {
    expect(changeText(change).detail).toBe(english);
    resetLocaleForTests('he');
    expect(changeText(change).detail).toBe(hebrew);
  });

  it('labels the selected compartment and partition from the right in Hebrew', () => {
    const design = loadDesign('basic');
    const last = design.compartments.at(-1);
    resetLocaleForTests('he');
    expect(describeSelection(design, { id: last.id, kind: 'compartment' })).toMatch(/^תא 1 /);
    expect(describeSelection(design, { id: design.partitions.at(-1).id, kind: 'partition' })).toMatch(/^מחיצה 1 /);
    resetLocaleForTests('en');
    expect(describeSelection(design, { id: last.id, kind: 'compartment' })).toMatch(new RegExp(`^Compartment ${design.compartments.length} `));
  });
});

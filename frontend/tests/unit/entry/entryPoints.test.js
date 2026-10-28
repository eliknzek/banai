import { describe, expect, it } from 'vitest';
import { STRINGS } from '../../../src/chat/i18n.js';
import { ENTRY_POINTS, getEntryPoint, TEMPLATE_ENTRIES } from '../../../src/entry/entryPoints.js';

describe('entry points', () => {
  it('offers exactly the three spec entry points, in order', () => {
    expect(ENTRY_POINTS.map((e) => e.id)).toEqual(['guided', 'freeText', 'basic']);
  });

  it('focuses the chat (with a localized hint) for the two AI entry points only', () => {
    expect(ENTRY_POINTS.filter((e) => e.focusesChat).map((e) => e.id)).toEqual(['guided', 'freeText']);
    for (const strings of Object.values(STRINGS)) {
      expect(strings.composerHints.guided).toBeTruthy();
      expect(strings.composerHints.freeText).toBeTruthy();
    }
  });

  it('adds the templates as extra manual entries, after the three entry points', () => {
    expect(TEMPLATE_ENTRIES.map((e) => e.templateId)).toEqual(['kids', 'double_sliding', 'minimalist']);
    expect(TEMPLATE_ENTRIES.every((e) => !e.focusesChat && e.title && e.description)).toBe(true);
    expect(Object.isFrozen(TEMPLATE_ENTRIES[0])).toBe(true);
  });

  it('returns null for an unknown id and the data is immutable', () => {
    expect(getEntryPoint('nope')).toBeNull();
    expect(Object.isFrozen(ENTRY_POINTS)).toBe(true);
    expect(Object.isFrozen(ENTRY_POINTS[0])).toBe(true);
  });
});

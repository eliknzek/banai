import { afterEach, describe, expect, it } from 'vitest';
import en from '../../../src/i18n/en.js';
import he from '../../../src/i18n/he.js';
import {
  apiErrorMessage, catalogName, DEFAULT_LOCALE, formatCm, getDirection, getLocale, resetLocaleForTests, setLocale, t, tOr,
} from '../../../src/i18n/index.js';
import { changeText } from '../../../src/i18n/changes.js';
import { friendlyError } from '../../../src/editor/opsFromForm.js';
import { DomainError } from '../../../src/domain/errors.js';
import { loadCatalog } from '../domain/helpers.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => resetLocaleForTests('en'));

describe('dictionaries', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  });

  it('use the same {placeholders} for every key', () => {
    for (const key of Object.keys(en)) expect(placeholders(he[key]), key).toEqual(placeholders(en[key]));
  });

  it('translate every Hebrew string (no English left in Hebrew text)', () => {
    // Allowed Latin in Hebrew strings: product names, keys and units.
    const allowed = /\b(BanAI|AI|MDF|EN|Enter|Shift)\b/g;
    for (const [key, value] of Object.entries(he)) {
      const latin = value.replace(allowed, '').replace(/\{\w+\}/g, '').match(/[A-Za-z]{2,}/g);
      expect(latin, `${key}: ${value}`).toBeNull();
    }
  });

  it('name every catalog entry in both languages', () => {
    const catalog = loadCatalog();
    for (const [section, entries] of Object.entries(catalog)) {
      for (const entry of entries) {
        expect(en[`catalog.${section}.${entry.id}`], entry.id).toBe(entry.name);
        expect(he[`catalog.${section}.${entry.id}`], entry.id).toMatch(/[֐-׿]|MDF/);
      }
    }
  });
});

describe('t()', () => {
  it('fills placeholders, keeps unknown ones, and falls back to English then to the key', () => {
    expect(t('compartment.label', { n: 2 })).toBe('Compartment 2');
    expect(t('compartment.label')).toBe('Compartment {n}');
    expect(t('no.such.key')).toBe('no.such.key');
    expect(tOr('no.such.key', 'fallback')).toBe('fallback');
  });

  it('defaults to Hebrew, right to left', () => {
    resetLocaleForTests(DEFAULT_LOCALE);
    expect(getLocale()).toBe('he');
    expect(getDirection()).toBe('rtl');
    expect(t('top.save')).toBe('שמירה');
    expect(formatCm(2400)).toBe('240.0 ס״מ');
  });

  it('only accepts known languages and notifies on a change', () => {
    expect(setLocale('fr', { persist: false })).toBe(false);
    expect(getLocale()).toBe('en');
    expect(setLocale('he', { persist: false })).toBe(true);
    expect(getDirection()).toBe('rtl');
  });
});

describe('Hebrew wording', () => {
  it('names catalog values in Hebrew, with the server name as fallback', () => {
    resetLocaleForTests('he');
    expect(catalogName('colors', { id: 'walnut', name: 'Walnut' })).toBe('אגוז');
    expect(catalogName('colors', { id: 'unknown_id', name: 'Server name' })).toBe('Server name');
  });

  it('words domain errors and server errors in Hebrew', () => {
    resetLocaleForTests('he');
    expect(friendlyError(new DomainError('OVERLAP', 'x', 'x'))).toBe(he['domain.OVERLAP']);
    expect(friendlyError({ code: 'SOMETHING_NEW' })).toBe(he['domain.generic']);
    expect(apiErrorMessage({ code: 'AGENT_UNAVAILABLE', reason: 'quota', message: 'English text' })).toBe(he['agent.quota']);
    expect(apiErrorMessage({ code: 'STALE' })).toBe(he['chat.stale']);
    expect(apiErrorMessage({ code: 'WHATEVER', message: 'English server text' })).toBe(he['api.generic']);
  });

  it('keeps the server text in English for unknown error codes', () => {
    expect(apiErrorMessage({ code: 'WHATEVER', message: 'English server text' })).toBe('English server text');
  });
});

describe('proposal card rows from server keys', () => {
  const rows = [
    [{ key: 'dimensions', params: { width: 2400 } }, ['Dimensions', 'Width 240.0 cm'], ['מידות', 'רוחב 240.0 ס״מ']],
    [{ key: 'doors', params: { type: 'sliding', count: 2 } }, ['Doors', 'Sliding, 2 panels'], ['דלתות', 'הזזה, 2 כנפיים']],
    [{ key: 'shelfAdded', params: { ref: { kind: 'compartment', index: 2 }, y: 1000 } },
      ['Shelf added', 'Compartment 2, at 100.0 cm'], ['נוסף מדף', 'תא 2, בגובה 100.0 ס״מ']],
    [{ key: 'material', params: { target: { kind: 'doors' }, values: [{ field: 'color', catalogId: 'walnut' }, { field: 'finish', catalogId: 'gloss' }] } },
      ['All doors', 'Walnut, Gloss'], ['כל הדלתות', 'אגוז, מבריק']],
    [{ key: 'material', params: { target: { kind: 'carcass' }, values: [{ field: 'color', custom: 'ירוק מרווה' }] } },
      ['Carcass & interior', 'ירוק מרווה'], ['גוף הארון והפנים', 'ירוק מרווה']],
    [{ key: 'removed', params: { ref: { kind: 'shelf', compartment: 1 } } }, ['Removed', 'Shelf in compartment 1'], ['הוסר', 'מדף בתא 1']],
    [{ key: 'compartments', params: { widths: [643, 643, 143, 481] } },
      ['Compartments', '64.3 · 64.3 · 14.3 · 48.1 cm'], ['תאים', '64.3 · 64.3 · 14.3 · 48.1 ס״מ']],
    [{ key: 'narrow', params: { index: 3, width: 143 } }, ['Narrow compartment', 'Compartment 3: 14.3 cm'], ['תא צר', 'תא 3: 14.3 ס״מ']],
  ];

  it.each(rows)('%o reads the same as the server English, and naturally in Hebrew', (change, english, hebrew) => {
    expect(changeText(change)).toMatchObject({ title: english[0], detail: english[1] });
    resetLocaleForTests('he');
    expect(changeText(change)).toMatchObject({ title: hebrew[0], detail: hebrew[1] });
  });

  it('keeps the compartment widths in wardrobe order (left to right) in both languages', () => {
    resetLocaleForTests('he');
    expect(changeText({ key: 'compartments', params: { widths: [643, 143] } }).detailDir).toBe('ltr');
    expect(changeText({ key: 'dimensions', params: { width: 2400 } }).detailDir).toBeUndefined();
  });

  it('never resolves server-provided keys to built-in object properties', () => {
    resetLocaleForTests('he');
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(changeText({ key, params: {}, title: 'T', detail: 'D' })).toEqual({ title: 'T', detail: 'D' });
      expect(t(key)).toBe(key);
      expect(tOr(`catalog.colors.${key}`, 'fallback')).toBe('fallback');
    }
    expect(t('compartment.label', Object.create({ n: 'inherited' }))).toBe('תא {n}');
  });

  it('falls back to the server English for unknown keys or bad params', () => {
    resetLocaleForTests('he');
    expect(changeText({ key: 'future', params: {}, title: 'T', detail: 'D' })).toEqual({ title: 'T', detail: 'D' });
    expect(changeText({ title: 'T', detail: 'D' })).toEqual({ title: 'T', detail: 'D' });
  });
});

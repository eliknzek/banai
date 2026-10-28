import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createTheme, DEFAULT_THEME, THEMES } from '../../../src/ui/theme.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
};
const fakeRoot = () => ({ dataset: {} });

describe('createTheme', () => {
  it('has five themes, the original look first', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(['terracotta', 'sage', 'slate', 'midnight', 'neon']);
    expect(DEFAULT_THEME).toBe('terracotta');
  });

  it('defaults to the original look and leaves <html> without a data-theme', () => {
    const root = fakeRoot();
    const theme = createTheme({ storage: memoryStorage(), root });
    expect(theme.get()).toBe('terracotta');
    expect(theme.index()).toBe(0);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('applies, remembers and announces a new theme', () => {
    const storage = memoryStorage();
    const root = fakeRoot();
    const theme = createTheme({ storage, root });
    const listener = vi.fn();
    theme.subscribe(listener);
    theme.set('midnight');
    expect(root.dataset.theme).toBe('midnight');
    expect(storage.data['banai.theme']).toBe('midnight');
    expect(listener).toHaveBeenCalledWith('midnight');
    expect(theme.index()).toBe(3);
    theme.set('terracotta');
    expect(root.dataset.theme).toBeUndefined();
  });

  it('restores the stored theme and ignores unknown values', () => {
    expect(createTheme({ storage: memoryStorage({ 'banai.theme': 'neon' }), root: fakeRoot() }).get()).toBe('neon');
    expect(createTheme({ storage: memoryStorage({ 'banai.theme': 'pink' }), root: fakeRoot() }).get()).toBe('terracotta');
    const theme = createTheme({ storage: memoryStorage(), root: fakeRoot() });
    const listener = vi.fn();
    theme.subscribe(listener);
    theme.set('pink');
    theme.set('terracotta'); // already current
    expect(listener).not.toHaveBeenCalled();
  });

  it('still works when storage throws (private mode)', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const root = fakeRoot();
    const theme = createTheme({ storage, root });
    theme.set('sage');
    expect(theme.get()).toBe('sage');
    expect(root.dataset.theme).toBe('sage');
  });
});

// WCAG AA for every theme: each text colour must reach 4.5:1 on the backgrounds it is used on.
describe('theme palettes (tokens.css)', () => {
  const css = readFileSync(new URL('../../../src/styles/tokens.css', import.meta.url), 'utf8');
  const declarations = (block) => Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
  const blockOf = (selector) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf('\n}', start));
  };
  const base = declarations(blockOf(':root'));
  const paletteOf = (id) => (id === DEFAULT_THEME ? base : { ...base, ...declarations(blockOf(`:root[data-theme="${id}"]`)) });

  const luminance = (hex) => {
    const [r, g, b] = hex.replace('#', '').match(/../g).map((part) => {
      const c = parseInt(part, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // [text, background]
  const PAIRS = [
    ...['surface', 'surface-container-lowest', 'surface-container-low', 'surface-container'].flatMap((bg) => [
      ['--md-sys-color-on-surface', `--md-sys-color-${bg}`],
      ['--md-sys-color-on-surface-variant', `--md-sys-color-${bg}`],
      ['--md-sys-color-primary', `--md-sys-color-${bg}`],
    ]),
    ['--md-sys-color-on-surface', '--theme-chat-tint'],
    ['--md-sys-color-on-surface-variant', '--theme-chat-tint'],
    ['--md-sys-color-on-primary', '--md-sys-color-primary'],
    ['--md-sys-color-on-primary', '--color-accent-hover'],
    ['--md-sys-color-on-primary-container', '--md-sys-color-primary-container'],
    ['--md-sys-color-on-secondary-container', '--md-sys-color-secondary-container'],
    ['--md-sys-color-on-secondary-container', '--theme-tonal-hover'],
    ['--md-sys-color-on-error-container', '--md-sys-color-error-container'],
    ['--theme-on-warning', '--theme-warning-container'],
    ['--theme-on-warning', '--theme-warning-container-strong'],
    ['--theme-on-success-container', '--theme-success-container'],
  ];

  THEMES.forEach(({ id }) => {
    it(`${id}: every text pair meets WCAG AA (4.5:1)`, () => {
      const palette = paletteOf(id);
      const failures = PAIRS
        .map(([text, background]) => [text, background, contrast(palette[text], palette[background])])
        .filter(([, , ratio]) => ratio < 4.5)
        .map(([text, background, ratio]) => `${text} on ${background}: ${ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  });
});

// Colour themes. The first is the original look; the rest are alternatives (two of them extreme).
// The palettes live in styles/tokens.css as :root[data-theme="..."]; this module only picks one,
// remembers it per browser (best effort) and applies it to <html>.
export const THEMES = Object.freeze([
  { id: 'terracotta', name: 'Terracotta' },
  { id: 'sage', name: 'Sage' },
  { id: 'slate', name: 'Slate' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'neon', name: 'Neon' },
]);
export const DEFAULT_THEME = THEMES[0].id;
const STORAGE_KEY = 'banai.theme';
const IDS = THEMES.map((theme) => theme.id);

function readStored(storage) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return IDS.includes(value) ? value : null;
  } catch {
    return null; // private mode / blocked storage: just use the default
  }
}

/** The chosen theme, remembered per browser and applied to `root` (an element with a dataset). */
export function createTheme({ storage = globalThis.localStorage, root = globalThis.document?.documentElement } = {}) {
  let theme = readStored(storage) ?? DEFAULT_THEME;
  const listeners = new Set();
  const apply = () => {
    if (!root) return;
    if (theme === DEFAULT_THEME) delete root.dataset.theme;
    else root.dataset.theme = theme;
  };
  apply();
  return {
    get: () => theme,
    index: () => IDS.indexOf(theme),
    nameOf: (id) => THEMES.find((entry) => entry.id === id)?.name ?? '',
    set(next) {
      if (!IDS.includes(next) || next === theme) return;
      theme = next;
      try {
        storage?.setItem(STORAGE_KEY, next);
      } catch {
        // not persisted; the choice still applies for this visit
      }
      apply();
      listeners.forEach((listener) => listener(theme));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

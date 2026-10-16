// Interface language (Hebrew by default, English on request). One dictionary per language; the
// server stays language-neutral and sends keys + params, which are rendered here.
// Text is only ever written with textContent / setAttribute, never as HTML.
import en from './en.js';
import he from './he.js';

const DICTIONARIES = Object.freeze({ he, en });
export const LOCALES = Object.freeze(['he', 'en']);
export const DEFAULT_LOCALE = 'he'; // the user's decision: the system opens in Hebrew
export const LOCALE_KEY = 'banai.locale';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readSaved() {
  try {
    const saved = storage()?.getItem(LOCALE_KEY);
    return LOCALES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

let locale = readSaved() ?? DEFAULT_LOCALE;
const listeners = new Set();

export const getLocale = () => locale;
export const getDirection = () => (locale === 'he' ? 'rtl' : 'ltr');

/**
 * Displayed number of the `index`-th (1-based, from the left) of `count` side-by-side parts
 * (compartments, partitions, doors). Right-to-left languages count from the right; the data
 * itself stays ordered left to right. Without a valid count the index is shown as is.
 */
export function spatialNumber(index, count) {
  if (getDirection() !== 'rtl' || !Number.isInteger(count) || !Number.isInteger(index) || index < 1 || index > count) return index;
  return count - index + 1;
}

// Own properties only: keys may come from the server (card rows, error codes, catalog ids), so
// a key such as "toString" or "__proto__" must never resolve to a built-in.
const lookup = (dictionary, key) => (typeof key === 'string' && Object.hasOwn(dictionary, key) ? dictionary[key] : undefined);

/** The string for `key` with {placeholders} filled in; English, then the key, as fallbacks. */
export function t(key, params = {}) {
  const template = lookup(DICTIONARIES[locale], key) ?? lookup(en, key) ?? String(key);
  return template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** Like t(), but returns `fallback` when no dictionary has the key (e.g. an unknown catalog id). */
export function tOr(key, fallback, params) {
  return lookup(DICTIONARIES[locale], key) !== undefined || lookup(en, key) !== undefined ? t(key, params) : fallback;
}

/** Centimetres from integer millimetres, with the unit: "240.0 cm" / "240.0 ס״מ". */
export const formatCm = (mm) => `${(mm / 10).toFixed(1)} ${t('unit.cm')}`;

export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Switch language. Unknown values are ignored. Returns true when the language is `next`. */
export function setLocale(next, { persist = true } = {}) {
  if (!LOCALES.includes(next)) return false;
  if (persist) {
    try {
      storage()?.setItem(LOCALE_KEY, next);
    } catch {
      // Remembering the choice is optional.
    }
  }
  if (next === locale) return true;
  locale = next;
  applyDocument();
  listeners.forEach((listener) => listener(locale));
  return true;
}

/** <html lang dir>, the page title and every [data-i18n*] element. */
export function applyDocument(doc = globalThis.document) {
  if (!doc) return;
  doc.documentElement.lang = locale;
  doc.documentElement.dir = getDirection();
  doc.title = t('app.title');
  applyStatic(doc);
}

/** Static markup opts in with data-i18n (text), data-i18n-aria, data-i18n-title, data-i18n-placeholder. */
export function applyStatic(root) {
  root.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((node) => node.setAttribute('aria-label', t(node.dataset.i18nAria)));
  root.querySelectorAll('[data-i18n-title]').forEach((node) => node.setAttribute('title', t(node.dataset.i18nTitle)));
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder)));
}

/** A catalog entry's display name in the current language (the server name as a fallback). */
export const catalogName = (section, entry) => tOr(`catalog.${section}.${entry.id}`, entry.name);

/** A short, translated message for a failed API call (never the raw server text in Hebrew). */
export function apiErrorMessage(error) {
  const code = error?.code;
  if (code === 'AGENT_UNAVAILABLE' && typeof error.reason === 'string') return tOr(`agent.${error.reason}`, t('agent.upstream'));
  if (code === 'STALE') return t('chat.stale');
  if (code === 'NETWORK') return t('api.network');
  return tOr(`api.${code}`, locale === 'en' && typeof error?.message === 'string' && error.message ? error.message : t('api.generic'));
}

/** For tests: forget the saved choice and return to the default language. */
export function resetLocaleForTests(next = DEFAULT_LOCALE) {
  locale = next;
}

// The three ways to start (spec section 6). All of them land in the same editor and data model.
// Texts are getters, so they always read in the current interface language.
import { t } from '../i18n/index.js';

const entry = (id, icon, { hint = true } = {}) => Object.freeze({
  id,
  icon,
  get title() { return t(`entry.${id}.title`); },
  get description() { return t(`entry.${id}.description`); },
  get action() { return t(`entry.${id}.action`); },
  get composerHint() { return hint ? t(`entry.${id}.hint`) : ''; },
});

export const ENTRY_POINTS = Object.freeze([
  entry('guided', 'chat'),
  entry('freeText', 'edit'),
  entry('basic', 'wardrobe', { hint: false }),
]);

export const getEntryPoint = (id) => ENTRY_POINTS.find((item) => item.id === id) ?? null;

// Small DOM builders for the properties panel. Text is always set via textContent or
// input.value, never innerHTML, so design data (e.g. custom names) cannot inject markup.
import { t } from '../i18n/index.js';
import { friendlyError, parseCm, toCmText } from './opsFromForm.js';

let fieldCounter = 0;
const nextId = (prefix) => `${prefix}-${(fieldCounter += 1)}`;

export function el(tag, { className, text, attrs = {}, i18n } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (i18n) {
    node.dataset.i18n = i18n; // static text: re-applied on a language switch (i18n/applyStatic)
    node.textContent = t(i18n);
  }
  Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
  node.append(...children);
  return node;
}

export function section(title, children) {
  return el('section', { className: 'prop-section' }, [el('h3', { className: 'prop-section__title', text: title }), ...children]);
}

/** A labelled input + inline message. `commit(rawText)` returns { ok, error?, message? }. */
function inputField({ label, value, testId, suffix, commit, inputMode = 'decimal' }) {
  const id = nextId('field');
  const input = el('input', { className: 'field__input', attrs: { id, type: 'text', inputmode: inputMode, autocomplete: 'off', dir: 'ltr' } });
  input.value = value;
  if (testId) input.dataset.testid = testId;
  const message = el('p', { className: 'field__message', attrs: { role: 'alert', 'aria-live': 'polite' } });
  const showError = (text) => {
    message.textContent = text;
    input.setAttribute('aria-invalid', 'true');
  };
  let lastSubmitted = value;
  const apply = () => {
    if (input.value === lastSubmitted) return;
    lastSubmitted = input.value;
    const result = commit(input.value);
    if (!result.ok) showError(result.message ?? friendlyError(result.error));
  };
  input.addEventListener('change', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') apply();
  });
  const control = el('div', { className: 'field__control' }, [input, ...(suffix ? [el('span', { className: 'field__suffix', text: suffix })] : [])]);
  return el('div', { className: 'field' }, [el('label', { className: 'field__label', text: label, attrs: { for: id } }), control, message]);
}

/** A centimetre field backed by an integer-millimetre value. `onCommit(mm)` dispatches. */
export function cmField({ label, mm, testId, onCommit }) {
  return inputField({
    label, testId, suffix: t('unit.cm'), value: toCmText(mm),
    commit: (text) => {
      const parsed = parseCm(text);
      return parsed.ok ? onCommit(parsed.mm) : parsed;
    },
  });
}

/** A whole-number field (counts). */
export function countField({ label, value, testId, onCommit }) {
  return inputField({
    label, testId, value: String(value), inputMode: 'numeric',
    commit: (text) => (/^\d{1,2}$/.test(text.trim()) ? onCommit(Number(text.trim())) : { ok: false, message: t('input.wholeNumber') }),
  });
}

export function segmented({ label, options, value, onChange, testId }) {
  const group = el('div', { className: 'segmented', attrs: { role: 'group', 'aria-label': label } });
  if (testId) group.dataset.testid = testId;
  options.forEach((option) => {
    const button = el('button', { className: 'segmented__option', text: option.label, attrs: { type: 'button', 'aria-pressed': String(option.value === value) } });
    button.addEventListener('click', () => {
      if (option.value !== value) onChange(option.value);
    });
    group.append(button);
  });
  return el('div', { className: 'field' }, [el('span', { className: 'field__label', text: label }), group]);
}

export function selectField({ label, options, value, onChange, testId }) {
  const id = nextId('select');
  const select = el('select', { className: 'field__input', attrs: { id } }, options.map((option) => {
    const node = el('option', { text: option.label, attrs: { value: option.value } });
    node.selected = option.value === value;
    return node;
  }));
  if (testId) select.dataset.testid = testId;
  select.addEventListener('change', () => onChange(select.value));
  return el('div', { className: 'field' }, [el('label', { className: 'field__label', text: label, attrs: { for: id } }), select]);
}

export function button(text, onClick, { variant = 'secondary', testId, disabled = false, i18n } = {}) {
  const node = el('button', { className: `btn btn--${variant}`, text, attrs: { type: 'button' }, i18n });
  if (testId) node.dataset.testid = testId;
  node.disabled = disabled;
  node.addEventListener('click', onClick);
  return node;
}

/** Shows a domain error from a non-input action (buttons, selects) under a section. */
export function actionResult(container, result) {
  container.querySelectorAll(':scope > .action-error').forEach((node) => node.remove());
  if (!result.ok) container.append(el('p', { className: 'field__message action-error', text: friendlyError(result.error), attrs: { role: 'alert' } }));
  return result;
}

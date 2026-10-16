// Save and share dialog. Saving needs the backend (Phase 7), so every action here is disabled and
// says so. Nothing is faked: no link is shown until a design has really been saved.
// Texts carry data-i18n keys, so a language switch relabels the dialog in place.
import { el, button } from '../editor/fields.js';
import { createDialog } from '../ui/dialog.js';

export function createSaveDialog() {
  const linkField = el('input', {
    className: 'field__input',
    attrs: { id: 'share-link', type: 'text', readonly: '', dir: 'ltr', 'data-i18n-placeholder': 'save.linkPlaceholder', 'data-i18n-aria': 'save.linkAria' },
  });
  linkField.dataset.testid = 'share-link';
  const dialog = createDialog({
    titleKey: 'save.title',
    labelId: 'save-dialog-title',
    testId: 'save-dialog',
    body: [
      el('p', { className: 'dialog__text', i18n: 'save.text' }),
      el('div', { className: 'field' }, [
        el('label', { className: 'field__label', i18n: 'save.linkLabel', attrs: { for: 'share-link' } }),
        linkField,
      ]),
      el('p', { className: 'dialog__note', i18n: 'save.note' }),
      el('p', { className: 'dialog__status', i18n: 'save.status', attrs: { role: 'status' } }),
    ],
    actions: [
      button('', () => {}, { variant: 'secondary', testId: 'copy-link', disabled: true, i18n: 'save.copy' }),
      button('', () => {}, { variant: 'primary', testId: 'save-confirm', disabled: true, i18n: 'save.confirm' }),
      button('', () => dialog.close(), { variant: 'ghost', testId: 'save-close', i18n: 'dialog.close' }),
    ],
  });
  return dialog;
}

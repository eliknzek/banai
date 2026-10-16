// Photorealistic render dialog. Rendering needs the backend image service (Phase 8), so the action
// is disabled and says so. The image is always labelled as illustrative, never as the accurate model.
// Texts carry data-i18n keys, so a language switch relabels the dialog in place.
import { el, button } from '../editor/fields.js';
import { t } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { createDialog } from '../ui/dialog.js';

export const renderDisclaimer = () => t('render.disclaimer');

export function createRenderDialog() {
  const placeholder = el('div', { className: 'render__placeholder' }, [icon('image', { size: 48 }), el('span', { i18n: 'render.placeholder' })]);
  const dialog = createDialog({
    titleKey: 'render.title',
    labelId: 'render-dialog-title',
    testId: 'render-dialog',
    body: [
      el('p', { className: 'dialog__text', i18n: 'render.text' }),
      placeholder,
      el('span', { className: 'chip', i18n: 'render.disclaimer' }),
      el('p', { className: 'dialog__status', i18n: 'render.status', attrs: { role: 'status' } }),
    ],
    actions: [
      button('', () => {}, { variant: 'primary', testId: 'render-generate', disabled: true, i18n: 'render.generate' }),
      button('', () => dialog.close(), { variant: 'ghost', testId: 'render-close', i18n: 'dialog.close' }),
    ],
  });
  return dialog;
}

// Photorealistic render dialog (Phase 8). "Generate" captures the current 3D view and asks the
// server for a realistic image of exactly this design. The image is always labelled illustrative,
// never as the accurate model, and the design itself is never changed. Closing the dialog stops
// waiting. Texts carry data-i18n keys, so a language switch relabels the dialog in place.
import { el, button } from '../editor/fields.js';
import { t } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { createDialog } from '../ui/dialog.js';

export const renderDisclaimer = () => t('render.disclaimer');

function download(image) {
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
  const link = el('a', { attrs: { href: url, download: `banai-render.${image.mimeType === 'image/png' ? 'png' : 'jpg'}` } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createRenderDialog({ session }) {
  const picture = el('img', { className: 'render__image', attrs: { 'data-i18n-aria': 'render.imageAlt', alt: '' } });
  picture.dataset.testid = 'render-image';
  const empty = el('div', { className: 'render__empty' }, [icon('image', { size: 48 }), el('span', { i18n: 'render.placeholder' })]);
  const working = el('div', { className: 'render__working', attrs: { role: 'status' } }, [
    el('span', { className: 'chat__dots', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span')]),
    el('span', { i18n: 'render.working' }),
  ]);
  working.dataset.testid = 'render-working';
  const stage = el('div', { className: 'render__placeholder' }, [empty, working, picture]);
  const message = el('p', { className: 'field__message', attrs: { role: 'alert' } });
  message.dataset.testid = 'render-error';

  const generate = button('', () => session.start(), { variant: 'primary', testId: 'render-generate', i18n: 'render.generate' });
  const save = button('', () => download(session.getState().image), { variant: 'secondary', testId: 'render-download', i18n: 'render.download' });
  const dialog = createDialog({
    titleKey: 'render.title',
    labelId: 'render-dialog-title',
    testId: 'render-dialog',
    body: [
      el('p', { className: 'dialog__text', i18n: 'render.text' }),
      stage,
      el('span', { className: 'chip', i18n: 'render.disclaimer' }),
      message,
    ],
    actions: [generate, save, button('', () => dialog.close(), { variant: 'ghost', testId: 'render-close', i18n: 'dialog.close' })],
  });
  dialog.element.addEventListener('close', () => session.cancel());

  const render = ({ status, image, message: text }) => {
    const busy = status === 'working';
    working.hidden = !busy;
    empty.hidden = busy || Boolean(image);
    picture.hidden = busy || !image;
    if (image) picture.src = `data:${image.mimeType};base64,${image.base64}`;
    message.textContent = status === 'error' ? text : '';
    generate.disabled = busy;
    generate.dataset.i18n = image ? 'render.again' : 'render.generate';
    generate.textContent = t(generate.dataset.i18n);
    save.hidden = !image || busy;
  };
  session.subscribe(render);
  render(session.getState());
  return dialog;
}

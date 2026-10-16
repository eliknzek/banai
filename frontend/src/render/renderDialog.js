// Photorealistic render dialog (Phase 8). "Generate" captures the current 3D view and asks the
// server for a realistic image of exactly this design. The image is always labelled illustrative,
// never as the accurate model, and the design itself is never changed. Closing the dialog stops
// waiting. Texts carry data-i18n keys, so a language switch relabels the dialog in place.
import { el, button } from '../editor/fields.js';
import { apiErrorMessage, t } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { createDialog } from '../ui/dialog.js';
import { createCarpenterAnimation } from './carpenterAnimation.js';
import { saveFile, shareSpec, specFileName } from './specShare.js';

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

/**
 * `requestSpec(renderBase64)` returns the spec PDF (Blob) for the committed design. The spec
 * buttons appear once a render exists, so the PDF carries the image the customer just saw.
 */
export function createRenderDialog({ session, requestSpec = null }) {
  const picture = el('img', { className: 'render__image', attrs: { 'data-i18n-aria': 'render.imageAlt', alt: '' } });
  picture.dataset.testid = 'render-image';
  const empty = el('div', { className: 'render__empty' }, [icon('image', { size: 48 }), el('span', { i18n: 'render.placeholder' })]);
  const workingText = el('span', { i18n: 'render.working' });
  const working = el('div', { className: 'render__working', attrs: { role: 'status' } }, [workingText]);
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

  // Carpenter spec: download, or send through the device's share sheet.
  const specNote = el('p', { className: 'dialog__note', i18n: 'spec.note' });
  const specMessage = el('p', { className: 'field__message', attrs: { role: 'alert' } });
  specMessage.dataset.testid = 'spec-error';
  let specBusy = false;
  const withSpec = (action, label) => async () => {
    if (specBusy || !requestSpec) return;
    specBusy = true;
    specMessage.textContent = '';
    label.textContent = t('spec.working');
    specButtons.forEach((b) => { b.disabled = true; });
    try {
      const blob = await requestSpec(session.getState().image.base64);
      await action(new File([blob], specFileName(), { type: 'application/pdf' }));
    } catch (error) {
      specMessage.textContent = error?.code ? apiErrorMessage(error) : t('spec.failed');
    } finally {
      specBusy = false;
      specButtons.forEach((b) => { b.disabled = false; b.textContent = t(b.dataset.i18n); });
    }
  };
  const specDownload = button('', () => {}, { variant: 'secondary', testId: 'spec-download', i18n: 'spec.download' });
  const specShare = button('', () => {}, { variant: 'primary', testId: 'spec-share', i18n: 'spec.share' });
  specDownload.addEventListener('click', withSpec((file) => saveFile(file), specDownload));
  specShare.addEventListener('click', withSpec((file) => shareSpec(file), specShare));
  const specButtons = [specShare, specDownload];
  const specBox = el('div', { className: 'spec-box' }, [specNote, el('div', { className: 'button-row' }, specButtons), specMessage]);
  specBox.dataset.testid = 'spec-box';
  if (requestSpec) message.after(specBox);
  dialog.element.addEventListener('close', () => session.cancel());

  let animating = false;
  const render = ({ status, image, message: text }) => {
    const busy = status === 'working';
    // A new random piece of furniture for every render.
    if (busy && !animating) working.replaceChildren(createCarpenterAnimation(), workingText);
    animating = busy;
    working.hidden = !busy;
    empty.hidden = busy || Boolean(image);
    picture.hidden = busy || !image;
    if (image) picture.src = `data:${image.mimeType};base64,${image.base64}`;
    message.textContent = status === 'error' ? text : '';
    generate.disabled = busy;
    generate.dataset.i18n = image ? 'render.again' : 'render.generate';
    generate.textContent = t(generate.dataset.i18n);
    save.hidden = !image || busy;
    specBox.hidden = !image || busy;
  };
  session.subscribe(render);
  render(session.getState());
  return dialog;
}

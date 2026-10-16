// The carpenter spec PDF: get it from the server, then download it or hand it to the device's
// share sheet (WhatsApp, mail, AirDrop...). The customer picks the recipient there; the app never
// asks for or stores an address. Where files cannot be shared, the PDF is downloaded and a mail
// draft opens so it can be attached. Browser APIs are injected for tests.
import { t } from '../i18n/index.js';

export const specFileName = (today = new Date()) => `banai-spec-${today.toISOString().slice(0, 10)}.pdf`;

export function saveFile(file, { doc = document, urls = URL } = {}) {
  const url = urls.createObjectURL(file);
  const link = doc.createElement('a');
  link.href = url;
  link.download = file.name;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => urls.revokeObjectURL(url), 1000);
}

/** Returns 'shared' | 'cancelled' | 'downloaded-mail'. */
export async function shareSpec(file, { nav = navigator, save = saveFile, openUrl = (url) => window.location.assign(url) } = {}) {
  const data = { files: [file], title: t('spec.shareTitle'), text: t('spec.shareText') };
  if (typeof nav?.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'; // the customer closed the share sheet
    }
  }
  save(file);
  openUrl(`mailto:?subject=${encodeURIComponent(t('spec.shareTitle'))}&body=${encodeURIComponent(t('spec.mailBody'))}`);
  return 'downloaded-mail';
}

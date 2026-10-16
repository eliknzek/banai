// The render dialog's state, without DOM: idle -> working -> done | error, one request at a time.
// Starting again or cancelling (closing the dialog) aborts the request that is still running.
import { apiErrorMessage, t } from '../i18n/index.js';

// The only image types the dialog will display (the server sends jpeg, or png in e2e).
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function createRenderSession({ snapshot, request }) {
  let state = { status: 'idle', image: null, message: '' };
  let controller = null;
  const listeners = new Set();
  const set = (next) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Capture the current 3D view and design, and ask for a photoreal image of it. */
    async start() {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      set({ status: 'working', message: '' });
      try {
        const { design, image, doorsVisible } = snapshot();
        const result = await request({ design, image, doorsVisible, signal: own.signal });
        if (controller !== own) return;
        set({ status: 'done', image: { base64: result.imageBase64, mimeType: IMAGE_TYPES.has(result.mimeType) ? result.mimeType : 'image/jpeg' } });
      } catch (error) {
        if (controller !== own || error?.name === 'AbortError') return;
        set({ status: 'error', message: error?.code ? apiErrorMessage(error) : t('render.failed') });
      } finally {
        if (controller === own) controller = null;
      }
    },

    /** Stop waiting (the dialog was closed). A finished image is kept for the next opening. */
    cancel() {
      if (!controller) return;
      controller.abort();
      controller = null;
      if (state.status === 'working') set({ status: state.image ? 'done' : 'idle' });
    },
  };
}

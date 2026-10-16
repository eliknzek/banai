import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/700.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import { apiUrl, applyProposal, getCatalog, getDefaultDesign, getSpec, renderDesign, sendChat, speakReply, transcribeAudio } from './api/client.js';
import { createStore } from './state/store.js';
import { mountPanel } from './editor/panel.js';
import { createViewer } from './viewer/viewer.js';
import { createChatModel } from './chat/chatModel.js';
import { mountChat } from './chat/chatPanel.js';
import { mountStartScreen } from './entry/startScreen.js';
import { createAudioPlayer } from './voice/player.js';
import { createRecorder, isRecordingSupported } from './voice/recorder.js';
import { createVoiceController } from './voice/voiceController.js';
import { createSaveDialog } from './share/saveDialog.js';
import { createRenderDialog } from './render/renderDialog.js';
import { createRenderSession } from './render/renderSession.js';
import { apiErrorMessage, applyDocument, getLocale, onLocaleChange, t } from './i18n/index.js';
import { createLanguageToggle } from './i18n/toggle.js';
import { createLogo } from './ui/logo.js';
import { installRipple } from './ui/ripple.js';

function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.hidden = false;
}

function bindInteriorToggle(store) {
  const toggle = document.getElementById('toggle-interior');
  toggle.addEventListener('change', () => store.setDoorsVisible(!toggle.checked));
  store.subscribe((state) => { toggle.checked = !state.ui.doorsVisible; });
}

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode or blocked storage: the mute choice is just not remembered
  }
}

const SIGNED_FIELDS = ['proposalId', 'baseRevision', 'baseHash', 'ops', 'signature'];

/**
 * Confirm = ask the server to verify and apply the signed proposal against the current
 * committed design, then commit its result. The viewer and the editor re-render from the store.
 */
function createProposalConfirm(store, chatModel) {
  let applying = false;
  return async (proposal) => {
    if (applying) return;
    applying = true;
    const { design, revision } = store.getState();
    const signed = Object.fromEntries(SIGNED_FIELDS.map((field) => [field, proposal[field]]));
    try {
      const applied = await applyProposal({ design, revision, proposal: signed });
      const result = store.replaceDesign(applied.design, applied.revision);
      chatModel.resolveProposal(t(result.ok ? 'chat.applied' : 'chat.notApplied'));
    } catch (error) {
      chatModel.resolveProposal(error?.code ? apiErrorMessage(error) : t('chat.notApplied'));
    } finally {
      applying = false;
    }
  };
}

function bindDialogs(store, viewer) {
  const save = createSaveDialog();
  // The render uses exactly what the customer sees: the committed design and the current 3D view.
  const session = createRenderSession({
    snapshot: () => {
      const { design, ui } = store.getState();
      return { design, image: viewer.capture(), doorsVisible: ui.doorsVisible };
    },
    request: (input) => renderDesign(input),
  });
  const render = createRenderDialog({
    session,
    requestSpec: (renderBase64) => getSpec({ design: store.getState().design, render: renderBase64, locale: getLocale() }),
  });
  document.getElementById('open-save').addEventListener('click', save.open);
  document.getElementById('open-render').addEventListener('click', render.open);
}

function mountTopbar() {
  const logo = document.getElementById('topbar-logo');
  const renderLogo = () => logo.replaceChildren(createLogo({ size: 34, tagline: t('app.tagline') }));
  renderLogo();
  onLocaleChange(renderLogo);
  document.getElementById('topbar-lang').replaceWith(createLanguageToggle({ className: 'topbar__lang' }));
}

async function boot() {
  applyDocument(); // <html lang/dir>, title and static texts in the interface language (Hebrew by default)
  mountTopbar();
  installRipple();
  let catalog;
  let initial;
  try {
    [catalog, initial] = await Promise.all([getCatalog(), getDefaultDesign()]);
  } catch {
    showError(t('error.unreachable'));
    return;
  }
  // Validates the server data before anything is rendered (throws on invalid data).
  const store = createStore({ design: initial.design, revision: initial.revision, catalog });
  const viewer = createViewer(document.getElementById('viewer'), store);
  bindInteriorToggle(store);
  mountPanel(document.getElementById('properties-content'), store);
  bindDialogs(store, viewer);
  applyDocument(); // the dialogs' static texts
  onLocaleChange(() => viewer.refreshLabels());

  // The agent always sees the latest committed design; it is only called on customer messages.
  const chatModel = createChatModel({
    getRevision: () => store.getState().revision,
    askAgent: (messages) => {
      const { design, revision } = store.getState();
      // Spoken replies start on the server together with the answer (see voiceController).
      return sendChat({ messages, design, revision, speak: !voice.isMuted(), locale: getLocale() });
    },
  });
  const voice = createVoiceController({
    chatModel,
    recorder: isRecordingSupported() ? createRecorder({ onLimit: () => voice.release() }) : null,
    transcribe: (blob) => transcribeAudio(blob),
    speak: (reply) => speakReply(reply),
    player: createAudioPlayer(),
    storage: safeLocalStorage(),
    resolveUrl: apiUrl,
  });
  const chat = mountChat(document.getElementById('chat-panel'), {
    model: chatModel,
    onConfirm: createProposalConfirm(store, chatModel),
    voice,
  });
  // A manual edit changes the revision, which may turn a pending proposal stale.
  store.subscribe(() => chat.refresh());

  if (import.meta.env.DEV) {
    window.__banai = Object.freeze({ store, viewer, chat: chatModel, voice });
  }

  mountStartScreen({
    onChoose: (entry) => {
      // All three entry points open the same editor; the chat ones also focus the composer.
      if (entry.id !== 'basic') chat.focus(() => entry.composerHint); // follows a later language switch
    },
  });
}

boot().catch(() => {
  showError(t('error.startFailed'));
});

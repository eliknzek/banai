// Left column: header, a welcome with starter prompts, the conversation, the proposal card and
// the composer. This panel never changes the design by itself: a proposal only applies when the
// customer presses Confirm, and the host (main.js) does the apply.
import { el } from '../editor/fields.js';
import { applyStatic, onLocaleChange, t } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { MAX_MESSAGE_LENGTH, suggestions } from './chatModel.js';
import { renderProposalCard } from './proposalCard.js';
import { createMicButton, createMuteToggle, voiceHint } from '../voice/voiceControls.js';

export function mountChat(container, { model, onConfirm, voice = null }) {
  container.classList.add('panel--chat');
  const mute = voice ? createMuteToggle(voice) : null;
  const mic = voice?.hasMicrophone() ? createMicButton(voice) : null;

  const header = el('header', { className: 'chat__header' }, [
    el('span', { className: 'chat__avatar' }, [icon('sparkle', { size: 22 })]),
    el('div', { className: 'chat__heading' }, [
      el('h2', { className: 'chat__title', i18n: 'chat.title' }),
      el('p', { className: 'chat__subtitle', i18n: 'chat.subtitle' }),
    ]),
    model.isConnected()
      ? el('span', { className: 'chat__status chat__status--online', i18n: 'chat.online' })
      : el('span', { className: 'chat__status', i18n: 'chat.soon', attrs: { 'data-i18n-title': 'chat.soonTitle' } }),
    ...(mute ? [mute.element] : []),
  ]);

  const input = el('textarea', { className: 'chat__input', attrs: { rows: '2', maxlength: String(MAX_MESSAGE_LENGTH), 'data-i18n-aria': 'chat.inputAria' } });
  // Typed text follows its own direction (dir=auto); while empty, the box (and its placeholder)
  // follows the interface direction, since dir=auto would fall back to left-to-right.
  const syncInputDirection = () => {
    if (input.value) input.dir = 'auto';
    else input.removeAttribute('dir');
  };
  input.addEventListener('input', syncInputDirection);
  // The placeholder can be an entry point's hint; it is kept as a function so it follows the language.
  let placeholder = () => t('chat.placeholder');
  input.dataset.testid = 'chat-input';
  const sendButton = el('button', { className: 'icon-btn icon-btn--filled chat__send', attrs: { type: 'submit', 'data-i18n-aria': 'chat.send' } }, [icon('send')]);
  sendButton.dataset.testid = 'chat-send';
  const composer = el('form', { className: 'chat__composer' }, [input, ...(mic ? [mic.element] : []), sendButton]);
  const hint = el('p', { className: 'chat__hint' });
  const hintText = () => (mic ? voiceHint(voice.getState()) : t('chat.hintTyping'));

  const chipRow = el('div', { className: 'welcome__chips' });
  const renderChips = () => chipRow.replaceChildren(...suggestions().map((text) => {
    const chip = el('button', { className: 'suggestion', attrs: { type: 'button' } }, [icon('sparkle', { size: 16 }), el('span', { text })]);
    chip.dataset.testid = 'suggestion';
    chip.addEventListener('click', () => {
      input.value = text; // only fills the composer: nothing is sent until the customer presses send
      syncInputDirection();
      input.focus();
    });
    return chip;
  }));
  const welcome = el('section', { className: 'welcome', attrs: { 'data-i18n-aria': 'chat.welcomeAria' } }, [
    el('h3', { className: 'welcome__title', i18n: 'chat.welcomeTitle' }),
    el('p', { className: 'welcome__text', i18n: 'chat.welcomeText' }),
    chipRow,
  ]);
  welcome.dataset.testid = 'chat-welcome';

  const list = el('div', { className: 'chat__messages', attrs: { role: 'log', 'aria-live': 'polite', 'data-i18n-aria': 'chat.conversation' } });
  list.dataset.testid = 'chat-messages';
  const thinking = el('div', { className: 'chat__thinking', attrs: { role: 'status' } }, [
    el('span', { className: 'chat__dots', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span')]),
    el('span', { i18n: 'chat.thinking' }),
  ]);
  thinking.dataset.testid = 'chat-thinking';
  const proposalSlot = el('div', { className: 'chat__proposal' });

  const submit = () => {
    if (model.send(input.value).ok) input.value = '';
    syncInputDirection();
  };
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  let renderedCount = 0;
  let renderedProposalKey = '';
  // Assistant bubbles whose text may still be waiting for its voice: id -> { bubble, span, message }.
  const revealing = new Map();
  const shownText = (message) => (voice && message.role === 'assistant' ? voice.visibleText(message) : message.text);

  function render() {
    const messages = model.getMessages();
    welcome.hidden = messages.length > 0 || model.getProposal() !== null;
    list.hidden = messages.length === 0;
    // Only newly added bubbles are created (and animate in); existing ones stay untouched,
    // except a spoken reply, whose whole text appears at once when its voice starts.
    if (messages.length < renderedCount) {
      list.replaceChildren();
      renderedCount = 0;
      revealing.clear();
    }
    messages.slice(renderedCount).forEach((message) => {
      // dir=auto: each bubble follows its own text direction (Hebrew replies render right-to-left).
      const bubble = el('div', { className: `chat__bubble chat__bubble--${message.role}`, attrs: { dir: 'auto' } });
      if (message.role === 'system') bubble.append(icon('info', { size: 16 }));
      const span = el('span', { text: '' });
      bubble.append(span);
      list.append(bubble);
      if (message.role === 'assistant') revealing.set(message.id, { bubble, span, message });
      else span.textContent = message.text;
    });
    renderedCount = messages.length;
    let pendingVoice = false;
    revealing.forEach(({ bubble, span, message }, id) => {
      const text = shownText(message);
      bubble.hidden = text === null;
      if (text === null) {
        pendingVoice = true;
        return;
      }
      if (span.textContent !== text) span.textContent = text;
      if (text === message.text) revealing.delete(id);
    });
    const busy = model.isBusy() || pendingVoice;
    thinking.hidden = !busy;
    sendButton.disabled = model.isBusy();
    list.scrollTop = list.scrollHeight;

    // The card waits for its reply's voice too, so text, voice and card arrive together.
    const proposal = pendingVoice ? null : model.getProposal();
    const status = model.getProposalStatus();
    const key = proposal ? `${proposal.id}:${status}` : '';
    if (key === renderedProposalKey) return;
    renderedProposalKey = key;
    proposalSlot.replaceChildren();
    if (proposal) {
      proposalSlot.append(renderProposalCard(proposal, status, {
        onConfirm,
        onCancel: () => model.cancelProposal(),
      }));
    }
  }

  container.replaceChildren(header, el('div', { className: 'chat__body' }, [welcome, list, thinking, proposalSlot]), el('div', { className: 'chat__footer' }, [composer, hint]));
  model.subscribe(render);
  if (voice) {
    const renderVoice = () => {
      mute.render();
      if (!mic) return;
      const state = voice.getState();
      mic.render(state);
      hint.textContent = hintText();
      hint.classList.toggle('chat__hint--live', state !== 'idle');
    };
    voice.subscribe(renderVoice);
    voice.subscribe(render);
    renderVoice();
  }
  // Interface language: relabel the panel in place; messages already in the chat stay as written.
  const renderLocale = () => {
    applyStatic(container);
    input.placeholder = placeholder();
    hint.textContent = hintText();
    renderChips();
    mute?.render();
    mic?.render(voice.getState());
    renderedProposalKey = ''; // re-word the card
    render();
  };
  onLocaleChange(renderLocale);
  renderLocale();

  return {
    focus: (hintFor) => {
      if (typeof hintFor === 'function') placeholder = hintFor;
      input.placeholder = placeholder();
      input.focus();
    },
    /** Re-render, e.g. after the design revision changed (a pending proposal may now be stale). */
    refresh: render,
  };
}

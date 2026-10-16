// Left column: header, a welcome with starter prompts, the conversation, the proposal card and
// the composer. This panel never changes the design by itself: a proposal only applies when the
// customer presses Confirm, and the host (main.js) does the apply.
import { el } from '../editor/fields.js';
import { icon } from '../ui/icons.js';
import { MAX_MESSAGE_LENGTH, SUGGESTIONS } from './chatModel.js';
import { renderProposalCard } from './proposalCard.js';
import { createMicButton, createMuteToggle, HINTS } from '../voice/voiceControls.js';

export function mountChat(container, { model, onConfirm, voice = null }) {
  container.classList.add('panel--chat');
  const mute = voice ? createMuteToggle(voice) : null;
  const mic = voice?.hasMicrophone() ? createMicButton(voice) : null;

  const header = el('header', { className: 'chat__header' }, [
    el('span', { className: 'chat__avatar' }, [icon('sparkle', { size: 22 })]),
    el('div', { className: 'chat__heading' }, [
      el('h2', { className: 'chat__title', text: 'AI Designer' }),
      el('p', { className: 'chat__subtitle', text: 'Design assistant' }),
    ]),
    model.isConnected()
      ? el('span', { className: 'chat__status chat__status--online', text: 'Online' })
      : el('span', { className: 'chat__status', text: 'Coming soon', attrs: { title: 'The AI agent is not connected on this server.' } }),
    ...(mute ? [mute.element] : []),
  ]);

  const input = el('textarea', { className: 'chat__input', attrs: { rows: '2', dir: 'auto', maxlength: String(MAX_MESSAGE_LENGTH), placeholder: 'Describe your wardrobe…', 'aria-label': 'Message to the AI designer' } });
  input.dataset.testid = 'chat-input';
  const sendButton = el('button', { className: 'icon-btn icon-btn--filled chat__send', attrs: { type: 'submit', 'aria-label': 'Send message' } }, [icon('send')]);
  sendButton.dataset.testid = 'chat-send';
  const composer = el('form', { className: 'chat__composer' }, [input, ...(mic ? [mic.element] : []), sendButton]);
  const hint = el('p', { className: 'chat__hint', text: mic ? HINTS.idle : 'Enter to send · Shift+Enter for a new line' });

  const chips = SUGGESTIONS.map((text) => {
    const chip = el('button', { className: 'suggestion', attrs: { type: 'button' } }, [icon('sparkle', { size: 16 }), el('span', { text })]);
    chip.dataset.testid = 'suggestion';
    chip.addEventListener('click', () => {
      input.value = text; // only fills the composer: nothing is sent until the customer presses send
      input.focus();
    });
    return chip;
  });
  const welcome = el('section', { className: 'welcome', attrs: { 'aria-label': 'Get started' } }, [
    el('h3', { className: 'welcome__title', text: 'What shall we design today?' }),
    el('p', { className: 'welcome__text', text: "Describe your wardrobe in your own words. I'll turn it into a proposal that you confirm before anything changes." }),
    el('div', { className: 'welcome__chips' }, chips),
  ]);
  welcome.dataset.testid = 'chat-welcome';

  const list = el('div', { className: 'chat__messages', attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' } });
  list.dataset.testid = 'chat-messages';
  const thinking = el('div', { className: 'chat__thinking', attrs: { role: 'status' } }, [
    el('span', { className: 'chat__dots', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span')]),
    el('span', { text: 'Designing…' }),
  ]);
  thinking.dataset.testid = 'chat-thinking';
  const proposalSlot = el('div', { className: 'chat__proposal' });

  const submit = () => {
    if (model.send(input.value).ok) input.value = '';
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
  function render() {
    const messages = model.getMessages();
    welcome.hidden = messages.length > 0 || model.getProposal() !== null;
    list.hidden = messages.length === 0;
    // Only newly added bubbles are created (and animate in); existing ones stay untouched.
    if (messages.length < renderedCount) {
      list.replaceChildren();
      renderedCount = 0;
    }
    messages.slice(renderedCount).forEach((message) => {
      // dir=auto: each bubble follows its own text direction (Hebrew replies render right-to-left).
      const bubble = el('div', { className: `chat__bubble chat__bubble--${message.role}`, attrs: { dir: 'auto' } });
      if (message.role === 'system') bubble.append(icon('info', { size: 16 }));
      bubble.append(el('span', { text: message.text }));
      list.append(bubble);
    });
    renderedCount = messages.length;
    const busy = model.isBusy();
    thinking.hidden = !busy;
    sendButton.disabled = busy;
    list.scrollTop = list.scrollHeight;

    // Re-render the card only when the proposal or its status changed (keeps its entrance animation calm).
    const proposal = model.getProposal();
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
      hint.textContent = HINTS[state];
      hint.classList.toggle('chat__hint--live', state !== 'idle');
    };
    voice.subscribe(renderVoice);
    renderVoice();
  }
  render();

  return {
    focus: (placeholder) => {
      if (placeholder) input.placeholder = placeholder;
      input.focus();
    },
    /** Re-render, e.g. after the design revision changed (a pending proposal may now be stale). */
    refresh: render,
  };
}

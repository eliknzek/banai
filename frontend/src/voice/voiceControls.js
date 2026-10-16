// DOM for voice: a hold-to-talk mic button for the composer and a mute toggle for the chat
// header. Rendering only; all behaviour lives in voiceController.js.
import { el } from '../editor/fields.js';
import { icon } from '../ui/icons.js';

export const HINTS = Object.freeze({
  idle: 'Enter to send · Hold the mic to talk',
  recording: 'Listening… release to send',
  transcribing: 'Transcribing…',
});
const HOLD_KEYS = new Set([' ', 'Enter']);

/** Hold-to-talk: pointer down/up, or Space/Enter held while the button has focus. */
export function createMicButton(voice) {
  const button = el('button', {
    className: 'icon-btn chat__mic',
    attrs: { type: 'button', 'aria-label': 'Hold to talk', title: 'Hold to talk', 'aria-pressed': 'false' },
  }, [icon('mic')]);
  button.dataset.testid = 'chat-mic';

  let held = false;
  const down = (event) => {
    event.preventDefault();
    if (held) return;
    held = true;
    voice.press();
  };
  const up = () => {
    if (!held) return;
    held = false;
    voice.release();
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    button.setPointerCapture?.(event.pointerId);
    down(event);
  });
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('lostpointercapture', up);
  button.addEventListener('keydown', (event) => {
    if (HOLD_KEYS.has(event.key) && !event.repeat) down(event);
  });
  button.addEventListener('keyup', (event) => { if (HOLD_KEYS.has(event.key)) up(); });
  button.addEventListener('blur', up);
  button.addEventListener('contextmenu', (event) => event.preventDefault()); // long-press on touch

  return {
    element: button,
    render(state) {
      button.classList.toggle('chat__mic--recording', state === 'recording');
      button.classList.toggle('chat__mic--busy', state === 'transcribing');
      button.setAttribute('aria-pressed', String(state === 'recording'));
      button.disabled = state === 'transcribing';
    },
  };
}

export function createMuteToggle(voice) {
  const button = el('button', { className: 'icon-btn chat__mute', attrs: { type: 'button' } });
  button.dataset.testid = 'chat-mute';
  button.addEventListener('click', () => voice.setMuted(!voice.isMuted()));
  return {
    element: button,
    render() {
      const muted = voice.isMuted();
      const label = muted ? 'Read replies aloud (currently muted)' : 'Mute spoken replies';
      button.replaceChildren(icon(muted ? 'volume-off' : 'volume'));
      button.setAttribute('aria-pressed', String(muted));
      button.setAttribute('aria-label', label);
      button.title = label;
    },
  };
}

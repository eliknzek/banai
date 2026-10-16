// Voice around the existing chat (spec §9a, ADR-007). It adds no new path to change a design:
// - push-to-talk: press opens the mic, release transcribes, and the transcript is sent with
//   chatModel.send() exactly like typed text (it shows as the customer's bubble first);
// - every new assistant reply is spoken, typed or not, unless the customer muted it.
//
// Text and voice arrive together: a spoken reply's text is held back until its audio starts, then
// shown in full at that moment. It is never stuck: muted, failed or blocked audio, or audio that
// has not started within SPEECH_START_TIMEOUT_MS, shows the text at once.
// Recorder, API, player and timers are injected, so this module holds no browser state of its own.

export const MUTE_KEY = 'banai.voice.muted';
export const SPEECH_START_TIMEOUT_MS = 2500;
export const MESSAGES = Object.freeze({
  permission: 'Microphone access was blocked. Allow it in your browser to talk to the AI designer.',
  noSpeech: "I didn't catch that. Hold the microphone button while you speak.",
  failed: 'The recording could not be transcribed. Please try again or type your message.',
  busy: 'Please wait for the current answer first.',
});

function readMuted(storage) {
  try {
    return storage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function createVoiceController({ chatModel, recorder, transcribe, speak, player, storage = null,
  resolveUrl = (path) => path, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) }) {
  let state = 'idle'; // idle | recording | transcribing
  let muted = readMuted(storage);
  let spokenUpTo = Math.max(0, ...chatModel.getMessages().map((message) => message.id));
  let speechRun = 0;
  // Spoken replies whose text waits for their voice: id -> { timer }.
  const reveals = new Map();
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const setState = (next) => { state = next; notify(); };
  // A reply that will be spoken but whose turn this controller has not handled yet. The chat
  // may render it a moment before announcing it (for example on a progress update of the
  // previous reply's voice), so it counts as waiting until sayReply takes over.
  const unannounced = (message) => !muted && message.role === 'assistant' && Boolean(message.replyToken)
    && message.id > spokenUpTo;

  function release(id) {
    const reveal = reveals.get(id);
    if (!reveal) return;
    clearTimer(reveal.timer);
    reveals.delete(id);
    notify();
  }
  const releaseAll = () => [...reveals.keys()].forEach(release);

  async function sayReply(message) {
    const run = ++speechRun;
    player.stop();
    // The new reply must be "waiting" before anyone re-renders: release the previous reply
    // silently and notify once, otherwise a render in between would show the new text early.
    reveals.forEach((previous) => clearTimer(previous.timer));
    reveals.clear();
    reveals.set(message.id, { timer: setTimer(() => release(message.id), SPEECH_START_TIMEOUT_MS) });
    notify();
    // The whole text appears the moment the voice starts (or right away if it cannot start).
    const handlers = {
      onPlaying: () => release(message.id),
      onEnded: () => release(message.id),
      onError: () => release(message.id),
    };
    try {
      // Fastest: the speech /api/chat already started on the server. Fallback: ask for it now.
      const source = message.speechUrl
        ? { url: resolveUrl(message.speechUrl) }
        : await speak({ text: message.text, token: message.replyToken });
      if (run !== speechRun || muted) {
        release(message.id);
        return;
      }
      await player.play(source, handlers);
    } catch {
      release(message.id); // speech is a convenience: show the text
    }
  }

  chatModel.subscribe(() => {
    const fresh = chatModel.getMessages().filter((message) => message.id > spokenUpTo);
    if (!fresh.length) return;
    spokenUpTo = fresh.at(-1).id;
    const reply = fresh.filter((message) => message.role === 'assistant' && message.replyToken).at(-1);
    if (reply && !muted) sayReply(reply);
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    isMuted: () => muted,
    hasMicrophone: () => recorder !== null,
    /** True while a spoken reply is about to start: the chat keeps its "thinking" state. */
    isWaiting: () => reveals.size > 0,
    /** A message's text to show now, or null while its voice has not started yet. */
    visibleText(message) {
      if (reveals.has(message.id) || unannounced(message)) return null;
      return message.text;
    },

    setMuted(next) {
      muted = Boolean(next);
      if (muted) {
        speechRun += 1;
        player.stop();
        releaseAll();
      }
      try {
        storage?.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        // Remembering the choice is optional.
      }
      notify();
    },

    /** Press: stop any reply that is playing and open the mic. */
    async press() {
      if (!recorder || state !== 'idle') return;
      if (chatModel.isBusy()) {
        chatModel.notice(MESSAGES.busy);
        return;
      }
      speechRun += 1;
      player.stop();
      releaseAll();
      setState('recording');
      try {
        await recorder.start();
      } catch {
        setState('idle');
        chatModel.notice(MESSAGES.permission);
      }
    },

    /** Release: transcribe and send the transcript as the customer's message. */
    async release() {
      if (state !== 'recording') return;
      const clip = await recorder.stop();
      if (!clip) {
        setState('idle');
        return;
      }
      setState('transcribing');
      let text = '';
      try {
        text = String((await transcribe(clip.blob))?.text ?? '').trim();
      } catch (error) {
        setState('idle');
        chatModel.notice(typeof error?.message === 'string' && error.code !== 'NETWORK' ? error.message : MESSAGES.failed);
        return;
      }
      setState('idle');
      if (!text) {
        chatModel.notice(MESSAGES.noSpeech);
        return;
      }
      const sent = chatModel.send(text);
      if (!sent.ok && sent.reason === 'busy') chatModel.notice(MESSAGES.busy);
    },
  };
}

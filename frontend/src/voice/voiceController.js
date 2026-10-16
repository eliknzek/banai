// Voice around the existing chat (spec §9a, ADR-007). It adds no new path to change a design:
// - push-to-talk: press opens the mic, release transcribes, and the transcript is sent with
//   chatModel.send() exactly like typed text (it shows as the customer's bubble first);
// - every new assistant reply is spoken, typed or not, unless the customer muted it.
// Recorder, API and player are injected, so this module holds no browser state of its own.

export const MUTE_KEY = 'banai.voice.muted';
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

export function createVoiceController({ chatModel, recorder, transcribe, speak, player, storage = null }) {
  let state = 'idle'; // idle | recording | transcribing
  let muted = readMuted(storage);
  let spokenUpTo = Math.max(0, ...chatModel.getMessages().map((message) => message.id));
  let speechRun = 0;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const setState = (next) => { state = next; notify(); };

  async function sayReply(message) {
    const run = ++speechRun;
    player.stop();
    try {
      const audio = await speak({ text: message.text, token: message.replyToken });
      if (run === speechRun && !muted) await player.play(audio);
    } catch {
      // Speech is a convenience: the reply is already visible in the chat.
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

    setMuted(next) {
      muted = Boolean(next);
      if (muted) {
        speechRun += 1;
        player.stop();
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

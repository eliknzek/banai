import { describe, expect, it, vi } from 'vitest';
import { createChatModel } from '../../../src/chat/chatModel.js';
import { createVoiceController, SPEECH_START_TIMEOUT_MS } from '../../../src/voice/voiceController.js';

function setup({ speechUrl = '/api/voice/stream/abcdefghijklmnop1234', muted = false } = {}) {
  const answer = { reply: 'Here is a proposal to widen it.', replyToken: 'a'.repeat(64), proposal: null, speechUrl };
  const chatModel = createChatModel({ getRevision: () => 1, askAgent: async () => answer });
  let handlers = null;
  const player = { stop: vi.fn(), play: vi.fn(async (source, h) => { handlers = h; player.source = source; }) };
  const timers = [];
  const voice = createVoiceController({
    chatModel, recorder: null, transcribe: vi.fn(), speak: vi.fn(async () => ({ body: {} })), player,
    resolveUrl: (path) => `http://api${path}`,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    storage: { getItem: () => (muted ? '1' : '0'), setItem() {} },
  });
  const reply = () => chatModel.getMessages().find((m) => m.role === 'assistant');
  return { chatModel, voice, player, timers, reply, handlers: () => handlers };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('text and voice arrive together', () => {
  it('holds the reply text until the voice starts, then shows all of it at once', async () => {
    const { chatModel, voice, player, reply, handlers } = setup();
    await chatModel.send('wider').done;
    await flush();
    expect(player.source).toEqual({ url: 'http://api/api/voice/stream/abcdefghijklmnop1234' });
    expect(voice.visibleText(reply())).toBeNull();
    expect(voice.isWaiting()).toBe(true);
    handlers().onPlaying();
    expect(voice.isWaiting()).toBe(false);
    expect(voice.visibleText(reply())).toBe(reply().text); // whole text, not word by word
    handlers().onEnded();
    expect(voice.visibleText(reply())).toBe(reply().text);
  });

  it('shows the full text if the voice has not started in time', async () => {
    const { chatModel, voice, timers, reply } = setup();
    await chatModel.send('wider').done;
    await flush();
    expect(timers[0].ms).toBe(SPEECH_START_TIMEOUT_MS);
    timers[0].fn();
    expect(voice.visibleText(reply())).toBe(reply().text);
  });

  it('shows the full text at once on an audio error, and when muted', async () => {
    const failing = setup();
    await failing.chatModel.send('wider').done;
    await flush();
    failing.handlers().onError();
    expect(failing.voice.visibleText(failing.reply())).toBe(failing.reply().text);

    const silent = setup({ muted: true });
    await silent.chatModel.send('wider').done;
    await flush();
    expect(silent.player.play).not.toHaveBeenCalled();
    expect(silent.voice.visibleText(silent.reply())).toBe(silent.reply().text);
  });

  it('falls back to /api/voice/speak when the server did not start the speech', async () => {
    const { chatModel, player } = setup({ speechUrl: null });
    await chatModel.send('wider').done;
    await flush();
    expect(player.source).toEqual({ body: {} });
  });

  it('treats a new spoken reply as waiting even before the chat announced it (no flash of text)', () => {
    const { voice } = setup();
    const early = { id: 99, role: 'assistant', text: 'Here is a proposal.', replyToken: 'a'.repeat(64) };
    expect(voice.visibleText(early)).toBeNull();
    expect(voice.visibleText({ ...early, replyToken: undefined })).toBe(early.text);
    voice.setMuted(true);
    expect(voice.visibleText(early)).toBe(early.text);
  });

  it('a new reply stays hidden at every render while the previous reply is still speaking', async () => {
    const { chatModel, voice, handlers } = setup();
    await chatModel.send('first').done;
    await flush();
    handlers().onPlaying(); // the first reply is being spoken
    const seen = [];
    const record = () => {
      const latest = chatModel.getMessages().filter((m) => m.role === 'assistant').at(-1);
      if (latest.id !== 2) seen.push(voice.visibleText(latest));
    };
    voice.subscribe(record);
    chatModel.subscribe(record);
    await chatModel.send('second').done;
    await flush();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((text) => text === null)).toBe(true);
  });

  it('ignores a speechUrl that is not a stream path', () => {
    const chatModel = createChatModel({ getRevision: () => 1, askAgent: async () => ({ reply: 'x', speechUrl: 'https://evil.example/a.mp3' }) });
    return chatModel.send('hi').done.then(() => {
      expect(chatModel.getMessages().at(-1).speechUrl).toBeUndefined();
    });
  });
});

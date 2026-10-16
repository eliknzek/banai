import { describe, expect, it, vi } from 'vitest';
import { createChatModel } from '../../../src/chat/chatModel.js';
import { speakReply, transcribeAudio } from '../../../src/api/client.js';
import { createAudioPlayer } from '../../../src/voice/player.js';
import { createRecorder, isRecordingSupported, MAX_RECORDING_MS, MIN_RECORDING_MS } from '../../../src/voice/recorder.js';
import { createVoiceController, MESSAGES, MUTE_KEY } from '../../../src/voice/voiceController.js';

const reply = (text = 'Here is a proposal', replyToken = 'a'.repeat(64)) => ({ reply: text, replyToken, proposal: null });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeRecorder({ clip = { blob: new Blob(['x']), durationMs: 900 }, fail = null } = {}) {
  return {
    start: vi.fn(async () => { if (fail) throw fail; }),
    stop: vi.fn(async () => clip),
  };
}
const fakePlayer = () => ({ play: vi.fn(async () => {}), stop: vi.fn() });
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, data };
}

function setup({ askAgent = vi.fn(async () => reply()), recorder = fakeRecorder(), transcript = 'Make it 240 cm wide', storage } = {}) {
  const chatModel = createChatModel({ getRevision: () => 1, askAgent });
  const player = fakePlayer();
  const speak = vi.fn(async () => new Blob(['mp3'], { type: 'audio/mpeg' }));
  const transcribe = vi.fn(async () => ({ text: transcript }));
  const voice = createVoiceController({ chatModel, recorder, transcribe, speak, player, storage });
  return { chatModel, player, speak, transcribe, voice, askAgent, recorder };
}

describe('voice controller', () => {
  it('push-to-talk: the transcript is sent like typed text and shown as the customer bubble', async () => {
    const { voice, chatModel, askAgent, transcribe } = setup();
    await voice.press();
    expect(voice.getState()).toBe('recording');
    const released = voice.release();
    await released;
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(chatModel.getMessages()[0]).toMatchObject({ role: 'user', text: 'Make it 240 cm wide' });
    expect(askAgent).toHaveBeenCalledWith([{ role: 'user', content: 'Make it 240 cm wide' }]);
    expect(voice.getState()).toBe('idle');
  });

  it('speaks every assistant reply once, typed or spoken, with its server token', async () => {
    const { chatModel, speak, player } = setup();
    await chatModel.send('typed request').done;
    await tick();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith({ text: 'Here is a proposal', token: 'a'.repeat(64) });
    expect(player.play).toHaveBeenCalledTimes(1);
    chatModel.notice('a system note');
    await tick();
    expect(speak).toHaveBeenCalledTimes(1); // system messages are never spoken
  });

  it('does not speak replies without a server token', async () => {
    const { chatModel, speak } = setup({ askAgent: async () => ({ reply: 'no token', proposal: null }) });
    await chatModel.send('hi').done;
    await tick();
    expect(speak).not.toHaveBeenCalled();
  });

  it('mute stops playback, skips speech and is remembered', async () => {
    const storage = memoryStorage();
    const { voice, chatModel, speak, player } = setup({ storage });
    voice.setMuted(true);
    expect(player.stop).toHaveBeenCalled();
    expect(storage.data[MUTE_KEY]).toBe('1');
    await chatModel.send('hi').done;
    await tick();
    expect(speak).not.toHaveBeenCalled();
    expect(setup({ storage: memoryStorage({ [MUTE_KEY]: '1' }) }).voice.isMuted()).toBe(true);
  });

  it('survives storage that throws', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const { voice } = setup({ storage });
    expect(voice.isMuted()).toBe(false);
    expect(() => voice.setMuted(true)).not.toThrow();
  });

  it('a new recording stops the reply that is playing', async () => {
    const { voice, player } = setup();
    await voice.press();
    expect(player.stop).toHaveBeenCalled();
  });

  it('reports a blocked microphone and returns to idle', async () => {
    const { voice, chatModel } = setup({ recorder: fakeRecorder({ fail: new DOMException('denied', 'NotAllowedError') }) });
    await voice.press();
    expect(voice.getState()).toBe('idle');
    expect(chatModel.getMessages().at(-1)).toMatchObject({ role: 'system', text: MESSAGES.permission });
  });

  it('ignores a clip that was too short, and says so when nothing was heard', async () => {
    const short = setup({ recorder: fakeRecorder({ clip: null }) });
    await short.voice.press();
    await short.voice.release();
    expect(short.transcribe).not.toHaveBeenCalled();
    expect(short.chatModel.getMessages()).toEqual([]);

    const silent = setup({ transcript: '   ' });
    await silent.voice.press();
    await silent.voice.release();
    expect(silent.askAgent).not.toHaveBeenCalled();
    expect(silent.chatModel.getMessages().at(-1).text).toBe(MESSAGES.noSpeech);
  });

  it('shows the server message when transcription fails', async () => {
    const { chatModel } = setup();
    const error = Object.assign(new Error('The AI designer has run out of credits.'), { code: 'AGENT_UNAVAILABLE' });
    const failing = createVoiceController({
      chatModel, recorder: fakeRecorder(), transcribe: async () => { throw error; }, speak: vi.fn(), player: fakePlayer(),
    });
    await failing.press();
    await failing.release();
    expect(chatModel.getMessages().at(-1).text).toBe(error.message);
    expect(failing.getState()).toBe('idle');
  });

  it('does not record while an answer is pending', async () => {
    let release;
    const { voice, chatModel, recorder } = setup({ askAgent: () => new Promise((r) => { release = r; }) });
    const sent = chatModel.send('first');
    await voice.press();
    expect(recorder.start).not.toHaveBeenCalled();
    expect(chatModel.getMessages().at(-1).text).toBe(MESSAGES.busy);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release(reply());
    await sent.done;
  });

  it('has no microphone when recording is unsupported', () => {
    const { voice } = setup({ recorder: null });
    expect(voice.hasMicrophone()).toBe(false);
    expect(isRecordingSupported({})).toBe(false);
    expect(isRecordingSupported({ MediaRecorder: class {}, navigator: { mediaDevices: { getUserMedia() {} } } })).toBe(true);
  });
});

function fakeEnv() {
  const tracks = [{ stop: vi.fn() }];
  class FakeMediaRecorder {
    static isTypeSupported = (type) => type === 'audio/webm;codecs=opus';
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType ?? ''; }
    start() { this.ondataavailable({ data: new Blob(['audio'], { type: this.mimeType }) }); }
    stop() { this.onstop(); }
  }
  const env = { MediaRecorder: FakeMediaRecorder, navigator: { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) } } };
  return { env, tracks };
}

describe('recorder', () => {
  it('records, releases the microphone afterwards and returns an opus blob', async () => {
    const { env, tracks } = fakeEnv();
    let t = 0;
    const recorder = createRecorder({ env, now: () => t });
    await recorder.start();
    expect(recorder.isRecording()).toBe(true);
    t = 1500;
    const clip = await recorder.stop();
    expect(clip.durationMs).toBe(1500);
    expect(clip.blob.type).toBe('audio/webm;codecs=opus');
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(false);
  });

  it('drops clips shorter than the minimum', async () => {
    const { env } = fakeEnv();
    let t = 0;
    const recorder = createRecorder({ env, now: () => t });
    await recorder.start();
    t = MIN_RECORDING_MS - 1;
    expect(await recorder.stop()).toBeNull();
  });

  it('fires onLimit at the maximum length', async () => {
    const { env } = fakeEnv();
    const onLimit = vi.fn();
    let scheduled;
    const recorder = createRecorder({ env, onLimit, setTimer: (fn, ms) => { scheduled = { fn, ms }; return 1; }, clearTimer: () => {} });
    await recorder.start();
    expect(scheduled.ms).toBe(MAX_RECORDING_MS);
    scheduled.fn();
    expect(onLimit).toHaveBeenCalled();
  });

  it('releases the mic when stopped while the permission prompt was open', async () => {
    const { env, tracks } = fakeEnv();
    let grant;
    env.navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { grant = resolve; });
    const recorder = createRecorder({ env });
    const starting = recorder.start();
    expect(await recorder.stop()).toBeNull();
    grant({ getTracks: () => tracks });
    await starting;
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(false);
  });
});

describe('audio player', () => {
  it('plays one clip at a time and revokes object urls', async () => {
    const audios = [];
    let made = 0;
    const urls = { createObjectURL: vi.fn(() => `blob:${made++}`), revokeObjectURL: vi.fn() };
    const createAudio = () => {
      const audio = { play: vi.fn(async () => {}), pause: vi.fn(), addEventListener: vi.fn() };
      audios.push(audio);
      return audio;
    };
    const player = createAudioPlayer({ createAudio, urls });
    await player.play(new Blob(['a']));
    await player.play(new Blob(['b']));
    expect(audios[0].pause).toHaveBeenCalled();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:0');
    player.stop();
    expect(player.isPlaying()).toBe(false);
  });

  it('swallows an autoplay block', async () => {
    const createAudio = () => ({ play: async () => { throw new DOMException('blocked', 'NotAllowedError'); }, pause() {}, addEventListener() {} });
    const player = createAudioPlayer({ createAudio, urls: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } });
    await expect(player.play(new Blob(['a']))).resolves.toBeUndefined();
    expect(player.isPlaying()).toBe(false);
  });
});

describe('voice api client', () => {
  it('uploads the recording as multipart and returns the transcript', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { text: 'שלום' } }) }));
    await expect(transcribeAudio(new Blob(['x'], { type: 'audio/webm' }), fetchImpl)).resolves.toEqual({ text: 'שלום' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/voice/transcribe');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('audio')).toBeInstanceOf(Blob);
  });

  it('returns the spoken audio blob and surfaces server errors', async () => {
    const audio = new Blob(['mp3'], { type: 'audio/mpeg' });
    const ok = vi.fn(async () => ({ ok: true, status: 200, blob: async () => audio }));
    await expect(speakReply({ text: 'hi', token: 't' }, ok)).resolves.toBe(audio);
    expect(JSON.parse(ok.mock.calls[0][1].body)).toEqual({ text: 'hi', token: 't' });
    const bad = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ success: false, error: { code: 'BAD_TOKEN', message: 'no' } }) }));
    await expect(speakReply({ text: 'hi', token: 't' }, bad)).rejects.toMatchObject({ code: 'BAD_TOKEN', status: 400 });
  });
});

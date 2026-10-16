// Plays one spoken reply at a time. Starting a new clip or calling stop() ends the current one.
//
// A streaming Response is played while it downloads (MediaSource), so speech starts as soon as
// the first mp3 chunk arrives instead of after the whole clip. Browsers without MediaSource
// support for mp3 fall back to downloading the clip first. A Blob is played directly.

const MP3 = 'audio/mpeg';

function streamable(source, MediaSourceImpl) {
  return Boolean(source?.body?.getReader && MediaSourceImpl?.isTypeSupported?.(MP3));
}

function appendChunk(buffer, chunk) {
  return new Promise((resolve, reject) => {
    const done = () => { buffer.removeEventListener('error', fail); resolve(); };
    const fail = () => { buffer.removeEventListener('updateend', done); reject(new Error('append failed')); };
    buffer.addEventListener('updateend', done, { once: true });
    buffer.addEventListener('error', fail, { once: true });
    buffer.appendBuffer(chunk);
  });
}

export function createAudioPlayer({ createAudio = () => new Audio(), urls = URL,
  MediaSourceImpl = globalThis.MediaSource } = {}) {
  let current = null;

  const stop = () => {
    if (!current) return;
    const clip = current;
    current = null;
    clip.reader?.cancel().catch(() => {});
    clip.audio.pause();
    urls.revokeObjectURL(clip.url);
  };

  function begin(src) {
    stop();
    const audio = createAudio();
    const clip = { audio, url: urls.createObjectURL(src), reader: null };
    current = clip;
    audio.addEventListener('ended', () => { if (current === clip) stop(); });
    audio.src = clip.url;
    return clip;
  }

  async function start(clip) {
    try {
      await clip.audio.play();
    } catch {
      if (current === clip) stop(); // autoplay blocked: the text is already in the chat
    }
  }

  async function playStream(response) {
    const mediaSource = new MediaSourceImpl();
    const clip = begin(mediaSource);
    await new Promise((resolve) => mediaSource.addEventListener('sourceopen', resolve, { once: true }));
    if (current !== clip) return;
    const buffer = mediaSource.addSourceBuffer(MP3);
    const reader = response.body.getReader();
    clip.reader = reader;
    let started = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (current !== clip) return;
        if (done) break;
        await appendChunk(buffer, value);
        if (current !== clip) return;
        if (!started) {
          started = true;
          start(clip); // play as soon as the first chunk is buffered; keep appending meanwhile
        }
      }
      if (mediaSource.readyState === 'open') mediaSource.endOfStream();
    } catch {
      if (current === clip && !started) stop();
      else if (mediaSource.readyState === 'open') mediaSource.endOfStream();
    }
  }

  return {
    stop,
    isPlaying: () => current !== null,

    /** Plays a streaming Response or a Blob. Resolves once the clip has been handed to the audio element. */
    async play(source) {
      if (streamable(source, MediaSourceImpl)) return playStream(source);
      const blob = typeof source?.blob === 'function' && !(source instanceof Blob) ? await source.blob() : source;
      return start(begin(blob));
    },
  };
}

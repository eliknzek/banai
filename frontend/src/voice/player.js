// Plays one spoken reply at a time. Starting a new clip or calling stop() ends the current one.
//
// Sources, fastest first:
// - { url }: the speech /api/chat already started on the server: fetched and played from the first
//   chunk (MediaSource), or streamed natively by <audio> where MediaSource cannot play mp3.
// - a streaming Response (POST /api/voice/speak fallback), played while it downloads (MediaSource).
// - a Blob, played directly.
// Optional handlers report playback, so the text can appear together with the voice:
// onPlaying(), onEnded(), onError().

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
  MediaSourceImpl = globalThis.MediaSource, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  let current = null;
  let pendingFetch = null;

  const stop = () => {
    pendingFetch = null;
    if (!current) return;
    const clip = current;
    current = null;
    clip.reader?.cancel().catch(() => {});
    clip.audio.pause();
    if (clip.objectUrl) urls.revokeObjectURL(clip.objectUrl);
  };

  function begin({ objectSource = null, url = null }, handlers) {
    stop();
    const audio = createAudio();
    const clip = { audio, objectUrl: objectSource ? urls.createObjectURL(objectSource) : null, reader: null };
    current = clip;
    const live = () => current === clip;
    audio.addEventListener('playing', () => { if (live()) handlers.onPlaying?.(); });
    audio.addEventListener('ended', () => {
      if (!live()) return;
      handlers.onEnded?.();
      stop();
    });
    audio.addEventListener('error', () => {
      if (!live()) return;
      handlers.onError?.();
      stop();
    });
    audio.src = url ?? clip.objectUrl;
    return clip;
  }

  async function start(clip, handlers) {
    try {
      await clip.audio.play();
    } catch {
      if (current === clip) {
        handlers.onError?.(); // autoplay blocked: the text is shown instead
        stop();
      }
    }
  }

  async function playStream(response, handlers) {
    const mediaSource = new MediaSourceImpl();
    const clip = begin({ objectSource: mediaSource }, handlers);
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
          start(clip, handlers); // play as soon as the first chunk is buffered; keep appending
        }
      }
      if (mediaSource.readyState === 'open') mediaSource.endOfStream();
    } catch {
      if (current === clip && !started) {
        handlers.onError?.();
        stop();
      } else if (mediaSource.readyState === 'open') mediaSource.endOfStream();
    }
  }

  return {
    stop,
    isPlaying: () => current !== null,

    /** Plays { url }, a streaming Response or a Blob. Resolves once playback has been requested. */
    async play(source, handlers = {}) {
      if (typeof source?.url === 'string' && !source.body) {
        // MediaSource starts on the first chunk; a plain <audio src> buffers more before playing.
        if (!MediaSourceImpl?.isTypeSupported?.(MP3)) return start(begin({ url: source.url }, handlers), handlers);
        const token = {};
        stop(); // ends the previous clip (and any earlier pending fetch)
        pendingFetch = token;
        let response;
        try {
          response = await fetchImpl(source.url);
        } catch {
          response = null;
        }
        if (pendingFetch !== token) return undefined; // superseded or stopped meanwhile
        pendingFetch = null;
        if (!response?.ok || !response.body) {
          handlers.onError?.();
          return undefined;
        }
        return playStream(response, handlers);
      }
      if (streamable(source, MediaSourceImpl)) return playStream(source, handlers);
      const blob = typeof source?.blob === 'function' && !(source instanceof Blob) ? await source.blob() : source;
      return start(begin({ objectSource: blob }, handlers), handlers);
    },
  };
}

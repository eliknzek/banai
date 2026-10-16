// Plays one spoken reply at a time. Starting a new clip or calling stop() ends the current one.

export function createAudioPlayer({ createAudio = () => new Audio(), urls = URL } = {}) {
  let current = null;

  const stop = () => {
    if (!current) return;
    current.audio.pause();
    urls.revokeObjectURL(current.url);
    current = null;
  };

  return {
    stop,
    isPlaying: () => current !== null,

    /** Resolves when playback starts. A browser autoplay block is swallowed: the text is in the chat. */
    async play(blob) {
      stop();
      const audio = createAudio();
      const url = urls.createObjectURL(blob);
      const clip = { audio, url };
      current = clip;
      audio.addEventListener('ended', () => { if (current === clip) stop(); });
      audio.src = url;
      try {
        await audio.play();
      } catch {
        if (current === clip) stop();
      }
    },
  };
}

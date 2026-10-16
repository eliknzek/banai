// Text that keeps pace with speech: the reply is revealed word by word while it is spoken.

const WORD = /\S+\s*/g;
// Rough speaking rate, used only until the audio's real duration is known.
const SECONDS_PER_WORD = 0.36;

/** The leading part of `text` for a playback fraction in [0, 1]. Never splits a word. */
export function revealWords(text, fraction) {
  if (!(fraction > 0)) return '';
  if (fraction >= 1) return text;
  const words = text.match(WORD) ?? [];
  const count = Math.min(words.length, Math.ceil(words.length * fraction));
  return words.slice(0, count).join('').trimEnd();
}

/** Playback progress in [0, 1). The real duration is used once the browser knows it. */
export function speechProgress(text, currentTime, duration) {
  const estimate = Math.max(1, (text.match(WORD)?.length ?? 1) * SECONDS_PER_WORD);
  const total = Number.isFinite(duration) && duration > 0 ? duration : estimate;
  return Math.min(0.98, Math.max(0, currentTime / total));
}

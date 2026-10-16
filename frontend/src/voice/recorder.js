// Push-to-talk recorder (spec §9a). The microphone is only open between start() and stop():
// tracks are released after every clip, so the browser's mic indicator turns off.
// Browser APIs are injected (`env`) so the logic is testable without a real microphone.

export const MAX_RECORDING_MS = 30_000;
export const MIN_RECORDING_MS = 300;
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function isRecordingSupported(env = globalThis) {
  return Boolean(env.MediaRecorder && env.navigator?.mediaDevices?.getUserMedia);
}

/**
 * start() opens the mic and records; stop() resolves with { blob, durationMs }, or null for a
 * clip too short to be speech. `onLimit` fires when a clip reaches MAX_RECORDING_MS.
 */
export function createRecorder({ env = globalThis, onLimit = () => {}, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  let session = null;

  const release = (stream) => stream.getTracks().forEach((track) => track.stop());

  return {
    isRecording: () => session !== null,

    async start() {
      if (session) return;
      const pending = { opening: null };
      session = pending;
      let stream;
      try {
        pending.opening = env.navigator.mediaDevices.getUserMedia({ audio: true });
        stream = await pending.opening;
      } catch (error) {
        session = null;
        throw error;
      }
      if (session !== pending) { // stopped while the permission prompt was open
        release(stream);
        return;
      }
      const mimeType = PREFERRED_TYPES.find((type) => env.MediaRecorder.isTypeSupported?.(type));
      const recorder = new env.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      const finished = new Promise((resolve) => {
        recorder.onstop = () => {
          release(stream);
          resolve(new Blob(chunks, { type: (recorder.mimeType || mimeType || 'audio/webm') }));
        };
      });
      Object.assign(pending, { recorder, finished, startedAt: now(), timer: setTimer(onLimit, MAX_RECORDING_MS) });
      recorder.start();
    },

    async stop() {
      const current = session;
      session = null;
      if (!current) return null;
      if (!current.recorder) return null; // released before the mic opened
      clearTimer(current.timer);
      const durationMs = now() - current.startedAt;
      current.recorder.stop();
      const blob = await current.finished;
      return durationMs < MIN_RECORDING_MS ? null : { blob, durationMs };
    },
  };
}

import { API_BASE_URL } from '../config.js';

/** A failed API call. `code` is the server's error code (e.g. STALE), or HTTP_<status>. */
export class ApiError extends Error {
  constructor(code, message, status, reason = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.reason = reason; // e.g. AGENT_UNAVAILABLE -> quota | network | ...; used for translation
  }
}

async function getJson(path, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  const response = await fetchImpl(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  const body = await response.json();
  if (!body || body.success !== true) {
    throw new Error(`Request to ${path} returned an unsuccessful response`);
  }
  return body.data;
}

async function post(path, init, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  try {
    return await fetchImpl(`${API_BASE_URL}${path}`, { method: 'POST', ...init });
  } catch (error) {
    if (error?.name === 'AbortError') throw error; // cancelled by the caller, not a network failure
    throw new ApiError('NETWORK', 'The design service could not be reached.', 0);
  }
}

async function errorFrom(response) {
  const body = await response.json().catch(() => null);
  const error = body?.error;
  const code = typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`;
  const message = typeof error?.message === 'string' ? error.message : 'The request failed. Please try again.';
  return new ApiError(code, message, response.status, typeof error?.reason === 'string' ? error.reason : null);
}

async function postJson(path, payload, fetchImpl) {
  const response = await post(path, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, fetchImpl);
  if (!response.ok) throw await errorFrom(response);
  const body = await response.json().catch(() => null);
  if (body?.success === true) return body.data;
  throw new ApiError(`HTTP_${response.status}`, 'The request failed. Please try again.', response.status);
}

export const getHealth = (fetchImpl = fetch) => getJson('/api/health', fetchImpl).then((data) => ({ success: true, data }));

export const getCatalog = (fetchImpl = fetch) => getJson('/api/catalog', fetchImpl);

/** Returns { design, revision } for the predefined basic wardrobe. */
export const getDefaultDesign = (fetchImpl = fetch) => getJson('/api/designs/default', fetchImpl);

/**
 * One agent turn. Returns { reply, replyToken, proposal | null, speechUrl | null }. Never changes
 * the design. With speak, the server starts the spoken reply at once and returns its speechUrl.
 */
export const sendChat = ({ messages, design, revision, speak = false, locale = 'en' }, fetchImpl = fetch) =>
  postJson('/api/chat', { messages, design, revision, speak, locale }, fetchImpl);

/** Absolute URL for a server path such as a speechUrl. */
export const apiUrl = (path) => `${API_BASE_URL}${path}`;

/** Apply a signed proposal. Returns { design, revision }. Throws ApiError code STALE on 409. */
export const applyProposal = ({ design, revision, proposal }, fetchImpl = fetch) =>
  postJson('/api/proposals/apply', { design, revision, proposal }, fetchImpl);

/**
 * Photoreal render of the current design. `image` is the base64 PNG capture of the 3D view.
 * Returns { imageBase64, mimeType }. The design is never changed. `signal` cancels the wait.
 */
export async function renderDesign({ design, image, doorsVisible = true, signal }, fetchImpl = fetch) {
  const response = await post('/api/render', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ design, image, doorsVisible }),
    signal,
  }, fetchImpl);
  if (!response.ok) throw await errorFrom(response);
  const body = await response.json().catch(() => null);
  if (body?.success === true) return body.data;
  throw new ApiError(`HTTP_${response.status}`, 'The request failed. Please try again.', response.status);
}

/** The carpenter spec PDF (a Blob) for the design, with the render as its illustration. */
export async function getSpec({ design, render = null, locale = 'he' }, fetchImpl = fetch) {
  const response = await post('/api/spec', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ design, render, locale }),
  }, fetchImpl);
  if (!response.ok) throw await errorFrom(response);
  return response.blob();
}

/** Push-to-talk recording -> { text }. The text then goes through sendChat like typed input. */
export async function transcribeAudio(blob, fetchImpl = fetch) {
  const form = new FormData();
  form.append('audio', blob, 'speech');
  const response = await post('/api/voice/transcribe', { body: form }, fetchImpl);
  if (!response.ok) throw await errorFrom(response);
  const body = await response.json().catch(() => null);
  if (body?.success === true) return body.data;
  throw new ApiError(`HTTP_${response.status}`, 'The request failed. Please try again.', response.status);
}

/**
 * Spoken audio for an agent reply (needs the reply's server token). Returns the streaming
 * mp3 Response, so the player can start before the whole clip has arrived.
 */
export async function speakReply({ text, token }, fetchImpl = fetch) {
  const response = await post('/api/voice/speak', {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, token }),
  }, fetchImpl);
  if (!response.ok) throw await errorFrom(response);
  return response;
}

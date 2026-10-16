import { API_BASE_URL } from '../config.js';

/** A failed API call. `code` is the server's error code (e.g. STALE), or HTTP_<status>. */
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
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

async function postJson(path, payload, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  let response;
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError('NETWORK', 'The design service could not be reached.', 0);
  }
  const body = await response.json().catch(() => null);
  if (response.ok && body?.success === true) return body.data;
  const error = body?.error;
  const code = typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`;
  const message = typeof error?.message === 'string' ? error.message : 'The request failed. Please try again.';
  throw new ApiError(code, message, response.status);
}

export const getHealth = (fetchImpl = fetch) => getJson('/api/health', fetchImpl).then((data) => ({ success: true, data }));

export const getCatalog = (fetchImpl = fetch) => getJson('/api/catalog', fetchImpl);

/** Returns { design, revision } for the predefined basic wardrobe. */
export const getDefaultDesign = (fetchImpl = fetch) => getJson('/api/designs/default', fetchImpl);

/** One agent turn. Returns { reply, proposal | null }. Never changes the design. */
export const sendChat = ({ messages, design, revision }, fetchImpl = fetch) =>
  postJson('/api/chat', { messages, design, revision }, fetchImpl);

/** Apply a signed proposal. Returns { design, revision }. Throws ApiError code STALE on 409. */
export const applyProposal = ({ design, revision, proposal }, fetchImpl = fetch) =>
  postJson('/api/proposals/apply', { design, revision, proposal }, fetchImpl);

import { describe, expect, it, vi } from 'vitest';
import { renderDesign } from '../../../src/api/client.js';
import { createRenderSession } from '../../../src/render/renderSession.js';
import { resetLocaleForTests } from '../../../src/i18n/index.js';
import en from '../../../src/i18n/en.js';
import he from '../../../src/i18n/he.js';

const snapshot = () => ({ design: { id: 'd' }, image: 'iVBORw0KGgo=', doorsVisible: false });

describe('render session', () => {
  it('captures the current design and view, then shows the image', async () => {
    const request = vi.fn(async () => ({ imageBase64: 'abc', mimeType: 'image/jpeg' }));
    const session = createRenderSession({ snapshot, request });
    const seen = [];
    session.subscribe((state) => seen.push(state.status));
    await session.start();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ design: { id: 'd' }, image: 'iVBORw0KGgo=', doorsVisible: false }));
    expect(request.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(seen).toEqual(['working', 'done']);
    expect(session.getState().image).toEqual({ base64: 'abc', mimeType: 'image/jpeg' });
  });

  it('only displays known image types', async () => {
    const session = createRenderSession({ snapshot, request: async () => ({ imageBase64: 'x', mimeType: 'text/html' }) });
    await session.start();
    expect(session.getState().image.mimeType).toBe('image/jpeg');
  });

  it('turns failures into a translated message', async () => {
    const error = Object.assign(new Error('x'), { code: 'AGENT_UNAVAILABLE', reason: 'quota' });
    const session = createRenderSession({ snapshot, request: async () => { throw error; } });
    await session.start();
    expect(session.getState()).toMatchObject({ status: 'error', message: en['agent.quota'] });
    resetLocaleForTests('he');
    const hebrew = createRenderSession({ snapshot, request: async () => { throw new Error('boom'); } });
    await hebrew.start();
    expect(hebrew.getState().message).toBe(he['render.failed']);
    resetLocaleForTests('en');
  });

  it('cancelling (closing the dialog) aborts the request and ignores its late result', async () => {
    let resolve;
    let signal;
    const session = createRenderSession({
      snapshot,
      request: ({ signal: s }) => { signal = s; return new Promise((r) => { resolve = r; }); },
    });
    const running = session.start();
    session.cancel();
    expect(signal.aborted).toBe(true);
    expect(session.getState().status).toBe('idle');
    resolve({ imageBase64: 'late', mimeType: 'image/png' });
    await running;
    expect(session.getState().image).toBeNull();
  });

  it('starting again replaces a running request', async () => {
    const signals = [];
    const resolvers = [];
    const session = createRenderSession({
      snapshot,
      request: ({ signal }) => { signals.push(signal); return new Promise((r) => resolvers.push(r)); },
    });
    const first = session.start();
    const second = session.start();
    expect(signals[0].aborted).toBe(true);
    resolvers[1]({ imageBase64: 'new', mimeType: 'image/png' });
    resolvers[0]({ imageBase64: 'old', mimeType: 'image/png' });
    await Promise.all([first, second]);
    expect(session.getState().image.base64).toBe('new');
  });
});

describe('renderDesign client', () => {
  it('posts the design and the capture, and returns the image', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { imageBase64: 'x', mimeType: 'image/jpeg' } }) }));
    const controller = new AbortController();
    await expect(renderDesign({ design: { a: 1 }, image: 'png', doorsVisible: true, signal: controller.signal }, fetchImpl))
      .resolves.toEqual({ imageBase64: 'x', mimeType: 'image/jpeg' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/render');
    expect(JSON.parse(init.body)).toEqual({ design: { a: 1 }, image: 'png', doorsVisible: true });
    expect(init.signal).toBe(controller.signal);
  });

  it('passes an abort through instead of reporting a network error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(renderDesign({ design: {}, image: 'p' }, vi.fn(async () => { throw abort; }))).rejects.toBe(abort);
  });
});

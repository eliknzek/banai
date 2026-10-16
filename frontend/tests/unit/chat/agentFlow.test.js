import { describe, expect, it, vi } from 'vitest';
import { AGENT_ERROR_MESSAGE, agentHistory, createChatModel, MAX_HISTORY } from '../../../src/chat/chatModel.js';
import { applyProposal, ApiError, sendChat } from '../../../src/api/client.js';
import { createStore } from '../../../src/state/store.js';
import { loadCatalog, loadDesign } from '../domain/helpers.js';

const serverProposal = {
  proposalId: 'prop_0123456789abcdef', baseRevision: 1, baseHash: 'a'.repeat(64), ops: [], signature: 'b'.repeat(64),
  summary: 'Wider', changes: [{ title: 'Dimensions', detail: 'Width 240.0 cm' }],
};

describe('connected chat model', () => {
  it('sends the conversation, shows the reply and holds the proposal without applying it', async () => {
    const askAgent = vi.fn().mockResolvedValue({ reply: 'Here you go', proposal: serverProposal });
    const model = createChatModel({ getRevision: () => 1, askAgent });
    expect(model.isConnected()).toBe(true);
    const sent = model.send('240 cm wide');
    expect(sent.ok).toBe(true);
    expect(model.isBusy()).toBe(true);
    await sent.done;
    expect(askAgent).toHaveBeenCalledWith([{ role: 'user', content: '240 cm wide' }]);
    expect(model.getMessages().map((m) => [m.role, m.text])).toEqual([['user', '240 cm wide'], ['assistant', 'Here you go']]);
    expect(model.getProposal()).toMatchObject({ id: serverProposal.proposalId, summary: 'Wider' });
    expect(model.getProposalStatus()).toBe('pending');
    expect(model.isBusy()).toBe(false);
  });

  it('allows one request at a time', async () => {
    let release;
    const model = createChatModel({ getRevision: () => 1, askAgent: () => new Promise((r) => { release = r; }) });
    const first = model.send('one');
    expect(model.send('two')).toEqual({ ok: false, reason: 'busy' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release({ reply: 'ok' });
    await first.done;
    expect(model.send('three').ok).toBe(true);
  });

  it('turns agent failures into a system message', async () => {
    const model = createChatModel({ getRevision: () => 1, askAgent: () => Promise.reject(new ApiError('AGENT_UNAVAILABLE', 'Out of credits', 503)) });
    await model.send('hi').done;
    expect(model.getMessages().at(-1)).toMatchObject({ role: 'system', text: 'Out of credits' });
    const silent = createChatModel({ getRevision: () => 1, askAgent: () => Promise.reject(new Error('')) });
    await silent.send('hi').done;
    expect(silent.getMessages().at(-1).text).toBe(AGENT_ERROR_MESSAGE);
  });

  it('marks the proposal stale after a manual edit', async () => {
    let revision = 1;
    const model = createChatModel({ getRevision: () => revision, askAgent: async () => ({ reply: 'ok', proposal: serverProposal }) });
    await model.send('wider').done;
    revision = 2;
    expect(model.getProposalStatus()).toBe('stale');
  });

  it('sends only customer and assistant turns, capped to the server limit', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 3 === 2 ? 'system' : 'user', text: `m${i}` }));
    const history = agentHistory(messages);
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history.every((m) => m.role !== 'system')).toBe(true);
    expect(history.at(-1)).toEqual({ role: 'user', content: 'm28' });
  });
});

describe('api client agent calls', () => {
  const ok = (data) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data }) });
  const fail = (status, error) => vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ success: false, error }) });

  it('posts chat and apply payloads as JSON', async () => {
    const fetchImpl = ok({ reply: 'hi', proposal: null });
    await expect(sendChat({ messages: [], design: {}, revision: 1 }, fetchImpl)).resolves.toEqual({ reply: 'hi', proposal: null });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ messages: [], design: {}, revision: 1 });
    await applyProposal({ design: {}, revision: 1, proposal: {} }, ok({ design: {}, revision: 2 }));
  });

  it('surfaces server error codes, including STALE on 409', async () => {
    const stale = applyProposal({ design: {}, revision: 1, proposal: {} }, fail(409, { code: 'STALE', message: 'changed' }));
    await expect(stale).rejects.toMatchObject({ name: 'ApiError', code: 'STALE', status: 409, message: 'changed' });
    await expect(sendChat({}, fail(500, null))).rejects.toMatchObject({ code: 'HTTP_500' });
    await expect(sendChat({}, vi.fn().mockRejectedValue(new TypeError('offline')))).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('store.replaceDesign', () => {
  const catalog = loadCatalog();
  const makeStore = () => createStore({ design: loadDesign('basic'), revision: 1, catalog });

  it('commits a valid server design with the server revision', () => {
    const store = makeStore();
    const design = structuredClone(store.getState().design);
    design.dimensions.depth = 550;
    expect(store.replaceDesign(design, 2)).toEqual({ ok: true });
    expect(store.getState()).toMatchObject({ revision: 2, design: { dimensions: { depth: 550 } } });
  });

  it('rejects invalid designs and non-increasing revisions without changing state', () => {
    const store = makeStore();
    const before = store.getState();
    const broken = structuredClone(before.design);
    broken.dimensions.width = 999;
    expect(store.replaceDesign(broken, 2).ok).toBe(false);
    expect(store.replaceDesign(before.design, 1).ok).toBe(false);
    expect(store.getState()).toBe(before);
  });
});

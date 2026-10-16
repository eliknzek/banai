import { describe, expect, it } from 'vitest';
import {
  createChatModel, MAX_MESSAGE_LENGTH, notConnectedMessage, proposalStatus, suggestions,
} from '../../../src/chat/chatModel.js';

const proposal = (baseRevision = 1) => ({
  id: 'p1',
  baseRevision,
  summary: 'Widen the wardrobe',
  changes: [{ title: 'Width', detail: '200 cm to 240 cm' }],
});

describe('proposalStatus', () => {
  it('is null without a proposal, pending at the same revision, stale after any change', () => {
    expect(proposalStatus(null, 1)).toBeNull();
    expect(proposalStatus(proposal(1), 1)).toBe('pending');
    expect(proposalStatus(proposal(1), 2)).toBe('stale');
  });
});

describe('chat model', () => {
  it('adds the customer message and an honest not-connected reply, and never an assistant answer', () => {
    const model = createChatModel({ getRevision: () => 1 });
    expect(model.send('  240 cm wide  ')).toEqual({ ok: true });
    const messages = model.getMessages();
    expect(messages.map((m) => m.role)).toEqual(['user', 'system']);
    expect(messages[0].text).toBe('240 cm wide');
    expect(messages[1].text).toBe(notConnectedMessage());
    expect(model.getProposal()).toBeNull();
  });

  it('rejects empty and over-long messages without adding anything', () => {
    const model = createChatModel({ getRevision: () => 1 });
    expect(model.send('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(model.send(undefined).ok).toBe(false);
    expect(model.send('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toEqual({ ok: false, reason: 'too-long' });
    expect(model.getMessages()).toEqual([]);
  });

  it('gives each message a unique id and notifies subscribers', () => {
    const model = createChatModel({ getRevision: () => 1 });
    let calls = 0;
    const off = model.subscribe(() => { calls += 1; });
    model.send('one');
    model.send('two');
    expect(new Set(model.getMessages().map((m) => m.id)).size).toBe(4);
    expect(calls).toBe(2);
    off();
    model.send('three');
    expect(calls).toBe(2);
  });

  it('marks a pending proposal stale when the revision moves on', () => {
    let revision = 1;
    const model = createChatModel({ getRevision: () => revision });
    model.setProposal(proposal(1));
    expect(model.getProposalStatus()).toBe('pending');
    revision = 2;
    expect(model.getProposalStatus()).toBe('stale');
  });

  it('cancel drops the proposal, leaves a note, and reports false when there is nothing to cancel', () => {
    const model = createChatModel({ getRevision: () => 1 });
    expect(model.cancelProposal()).toBe(false);
    model.setProposal(proposal());
    expect(model.cancelProposal()).toBe(true);
    expect(model.getProposal()).toBeNull();
    expect(model.getMessages().at(-1).text).toMatch(/No changes were made/);
  });

  it('resolveProposal clears the proposal and optionally posts a message', () => {
    const model = createChatModel({ getRevision: () => 1 });
    model.setProposal(proposal());
    model.resolveProposal('Applied.');
    expect(model.getProposal()).toBeNull();
    expect(model.getMessages().at(-1).text).toBe('Applied.');
    model.setProposal(proposal());
    model.resolveProposal();
    expect(model.getMessages()).toHaveLength(1);
  });
});

describe('suggestions', () => {
  it('offers a few short, immutable starter prompts that fit the message limit', () => {
    const SUGGESTIONS = suggestions();
    expect(SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(Object.isFrozen(SUGGESTIONS)).toBe(true);
    SUGGESTIONS.forEach((text) => {
      expect(text.trim()).toBe(text);
      expect(text.length).toBeLessThan(MAX_MESSAGE_LENGTH);
    });
    expect(new Set(SUGGESTIONS).size).toBe(SUGGESTIONS.length);
  });
});

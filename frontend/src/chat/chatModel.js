// Pure chat view-model (no DOM). With an `askAgent` function the model talks to the agent;
// without one a sent message gets an honest "not connected" reply. Either way nothing here
// ever changes the design: a proposal only applies when the host confirms it.
//
// A proposal is { id, baseRevision, summary, changes: [{ title, detail }] } plus the signed
// fields from the server. It is kept apart from the committed design and is only ever
// "pending" or "stale" (the design changed after it was made).

export const NOT_CONNECTED_MESSAGE =
  "The AI agent isn't connected yet (planned for Phase 5). You can design manually in the Properties panel.";
export const STALE_MESSAGE = 'Design changed. Ask the agent to re-propose.';
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY = 20; // matches the server's message cap
export const AGENT_ERROR_MESSAGE = 'The AI designer could not answer. Please try again.';

// Starter prompts shown before the first message. Picking one only fills the composer.
export const SUGGESTIONS = Object.freeze([
  '240 cm wide, 260 cm tall, white, three compartments',
  'Tall wardrobe with sliding doors and a hanging rail',
  'Four shelves on the left, hanging in the middle, three drawers on the right',
]);

export function proposalStatus(proposal, currentRevision) {
  if (!proposal) return null;
  return proposal.baseRevision === currentRevision ? 'pending' : 'stale';
}

/** Conversation sent to the agent: customer and assistant turns only, most recent last. */
export function agentHistory(messages) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_HISTORY)
    .map((message) => ({ role: message.role, content: message.text }));
}

export function createChatModel({ getRevision, askAgent = null }) {
  let nextId = 1;
  let proposal = null;
  let busy = false;
  const messages = [];
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const push = (role, text, extra = {}) => {
    messages.push(Object.freeze({ id: nextId, role, text, ...extra }));
    nextId += 1;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getMessages: () => [...messages],
    getProposal: () => proposal,
    getProposalStatus: () => proposalStatus(proposal, getRevision()),
    isConnected: () => typeof askAgent === 'function',
    isBusy: () => busy,

    /**
     * A customer message. Returns { ok } (plus `done`, a promise for the agent's answer, when
     * connected) and never touches the design. One request at a time.
     */
    send(rawText) {
      const text = String(rawText ?? '').trim();
      if (!text) return { ok: false, reason: 'empty' };
      if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'too-long' };
      if (busy) return { ok: false, reason: 'busy' };
      push('user', text);
      if (typeof askAgent !== 'function') {
        push('system', NOT_CONNECTED_MESSAGE);
        notify();
        return { ok: true };
      }
      busy = true;
      notify();
      const done = Promise.resolve()
        .then(() => askAgent(agentHistory(messages)))
        .then((answer) => {
          // replyToken lets the server speak this exact reply (and nothing else) aloud.
          if (answer?.reply) {
            const token = typeof answer.replyToken === 'string' ? { replyToken: answer.replyToken } : {};
            push('assistant', String(answer.reply), token);
          }
          if (answer?.proposal) proposal = { ...answer.proposal, id: answer.proposal.proposalId };
        })
        .catch((error) => {
          push('system', typeof error?.message === 'string' && error.message ? error.message : AGENT_ERROR_MESSAGE);
        })
        .finally(() => {
          busy = false;
          notify();
        });
      return { ok: true, done };
    },

    /** A short system note in the conversation (voice status, errors). Never touches the design. */
    notice(text) {
      push('system', String(text));
      notify();
    },

    /** Set by the agent integration (Phase 5) or the dev-only demo. */
    setProposal(next) {
      proposal = next;
      notify();
    },

    /** Cancel never changes the design; it only drops the pending proposal. */
    cancelProposal() {
      if (!proposal) return false;
      proposal = null;
      push('system', 'Proposal cancelled. No changes were made.');
      notify();
      return true;
    },

    /** Called after the host applied (or refused) the proposal. */
    resolveProposal(message) {
      proposal = null;
      if (message) push('system', message);
      notify();
    },
  };
}

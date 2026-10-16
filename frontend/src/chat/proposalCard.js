// Proposal card: a structured list of proposed changes with Confirm / Cancel. Pure DOM render
// from { proposal, status }. All text uses textContent (proposal text is untrusted data).
import { el } from '../editor/fields.js';
import { icon } from '../ui/icons.js';
import { STALE_MESSAGE } from './chatModel.js';

export function renderProposalCard(proposal, status, { onConfirm, onCancel }) {
  const stale = status === 'stale';
  // Rows are written by the server. A "warning" row (for example a narrow compartment) is
  // highlighted so the customer notices it before confirming.
  const rows = proposal.changes.map((change) => {
    const warning = change.level === 'warning';
    const row = el('li', { className: `proposal__row${warning ? ' proposal__row--warning' : ''}` }, [
      el('span', { className: 'proposal__title', attrs: { dir: 'auto' } }, [
        ...(warning ? [icon('info', { size: 16 })] : []),
        document.createTextNode(change.title),
      ]),
      el('span', { className: 'proposal__detail', text: change.detail, attrs: { dir: 'auto' } }),
    ]);
    if (warning) row.dataset.testid = 'proposal-warning';
    return row;
  });

  const confirm = el('button', { className: 'btn btn--primary', attrs: { type: 'button' } }, [icon('check', { size: 18 }), document.createTextNode(' Confirm')]);
  confirm.dataset.testid = 'proposal-confirm';
  confirm.disabled = stale;
  confirm.addEventListener('click', () => onConfirm(proposal));

  const cancel = el('button', { className: 'btn', text: 'Cancel', attrs: { type: 'button' } });
  cancel.dataset.testid = 'proposal-cancel';
  cancel.addEventListener('click', () => onCancel(proposal));

  const card = el('section', { className: `proposal${stale ? ' proposal--stale' : ''}`, attrs: { 'aria-label': 'Proposed changes' } }, [
    el('header', { className: 'proposal__header' }, [
      el('h3', { className: 'proposal__heading', text: 'Proposed changes' }),
      el('span', { className: 'proposal__count', text: `${proposal.changes.length} ${proposal.changes.length === 1 ? 'item' : 'items'}` }),
    ]),
    el('p', { className: 'proposal__summary', text: proposal.summary, attrs: { dir: 'auto' } }),
    el('ul', { className: 'proposal__list' }, rows),
    el('p', { className: 'proposal__note', text: 'Not applied yet. Confirm to apply these changes to your design.' }),
    el('div', { className: 'button-row' }, [confirm, cancel]),
  ]);
  card.dataset.testid = 'proposal-card';

  if (stale) {
    card.append(el('p', { className: 'proposal__stale', text: STALE_MESSAGE, attrs: { role: 'status' } }));
  }
  return card;
}

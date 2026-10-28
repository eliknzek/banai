// Start screen: three ways in (plus ready-made templates), one editor. Shown on load as a modal;
// choosing an option closes it.
import { el } from '../editor/fields.js';
import { icon } from '../ui/icons.js';
import { createLogo } from '../ui/logo.js';
import { ENTRY_POINTS, TEMPLATE_ENTRIES } from './entryPoints.js';

export const START_FOOTNOTE = 'Designs are illustrative previews and are not manufacturing drawings.';

export function mountStartScreen({ onChoose }) {
  const card = (entry, { heading, compact }) => {
    const action = el('button', { className: 'btn', attrs: { type: 'button' } }, [
      document.createTextNode(`${entry.action} `),
      icon('arrow', { size: 18 }),
    ]);
    action.dataset.testid = `entry-${entry.id}`;
    action.addEventListener('click', () => {
      dialog.close();
      dialog.remove();
      onChoose(entry);
    });
    return el('article', { className: compact ? 'entry-card entry-card--compact' : 'entry-card' }, [
      ...(entry.icon ? [el('span', { className: 'entry-card__icon' }, [icon(entry.icon, { size: 24 })])] : []),
      el(heading, { className: 'entry-card__title', text: entry.title }),
      el('p', { className: 'entry-card__text', text: entry.description }),
      action,
    ]);
  };
  const cards = ENTRY_POINTS.map((entry) => card(entry, { heading: 'h2' }));
  const templates = TEMPLATE_ENTRIES.map((entry) => card(entry, { heading: 'h3', compact: true }));

  const dialog = el('dialog', { className: 'start', attrs: { 'aria-labelledby': 'start-title' } }, [
    el('header', { className: 'start__bar' }, [createLogo({ size: 36 })]),
    el('main', { className: 'start__main' }, [
      el('h1', { className: 'start__title', text: 'Design your wardrobe', attrs: { id: 'start-title' } }),
      el('p', { className: 'start__subtitle', text: 'Choose how you would like to begin. You can switch between the AI designer and manual editing at any time.' }),
      el('div', { className: 'start__cards' }, cards),
      el('section', { className: 'start__templates', attrs: { 'aria-labelledby': 'start-templates-title' } }, [
        el('h2', { className: 'start__templates-title', text: 'Or start from a template', attrs: { id: 'start-templates-title' } }),
        el('div', { className: 'start__cards' }, templates),
      ]),
      el('p', { className: 'start__footnote', text: START_FOOTNOTE }),
      el('a', { className: 'start__footnote', text: 'הצהרת נגישות', attrs: { href: '/accessibility.html', lang: 'he' } }),
    ]),
  ]);
  dialog.dataset.testid = 'start-screen';
  // A choice is required: Esc must not leave the user on a blank workspace.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

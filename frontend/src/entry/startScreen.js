// Start screen: three ways in, one editor. Shown on load as a modal; choosing an option closes it.
// The language can be switched here too; the screen re-renders in place.
import { el } from '../editor/fields.js';
import { onLocaleChange, t } from '../i18n/index.js';
import { createLanguageToggle } from '../i18n/toggle.js';
import { icon } from '../ui/icons.js';
import { createLogo } from '../ui/logo.js';
import { ENTRY_POINTS } from './entryPoints.js';

export const startFootnote = () => t('start.footnote');

export function mountStartScreen({ onChoose }) {
  const dialog = el('dialog', { className: 'start', attrs: { 'aria-labelledby': 'start-title' } });
  dialog.dataset.testid = 'start-screen';
  const main = el('main', { className: 'start__main' });
  dialog.append(el('header', { className: 'start__bar' }, [createLogo({ size: 36 }), createLanguageToggle({ className: 'start__lang' })]), main);

  const choose = (entry) => {
    offLocale();
    dialog.close();
    dialog.remove();
    onChoose(entry);
  };

  const render = () => {
    const cards = ENTRY_POINTS.map((entry) => {
      const action = el('button', { className: 'btn', attrs: { type: 'button' } }, [
        document.createTextNode(`${entry.action} `),
        icon('arrow', { size: 18 }),
      ]);
      action.dataset.testid = `entry-${entry.id}`;
      action.addEventListener('click', () => choose(entry));
      return el('article', { className: 'entry-card' }, [
        el('span', { className: 'entry-card__icon' }, [icon(entry.icon, { size: 24 })]),
        el('h2', { className: 'entry-card__title', text: entry.title }),
        el('p', { className: 'entry-card__text', text: entry.description }),
        action,
      ]);
    });
    main.replaceChildren(
      el('h1', { className: 'start__title', text: t('start.title'), attrs: { id: 'start-title' } }),
      el('p', { className: 'start__subtitle', text: t('start.subtitle') }),
      el('div', { className: 'start__cards' }, cards),
      el('p', { className: 'start__footnote', text: startFootnote() }),
    );
  };
  const offLocale = onLocaleChange(render);
  render();

  // A choice is required: Esc must not leave the user on a blank workspace.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

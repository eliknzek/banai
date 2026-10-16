// "עברית | EN" language switch. Two buttons with aria-pressed; it relabels itself on a change.
import { getLocale, LOCALES, onLocaleChange, setLocale, t } from './index.js';

export function createLanguageToggle({ className = '' } = {}) {
  const group = document.createElement('div');
  group.className = `lang-toggle ${className}`.trim();
  group.setAttribute('role', 'group');
  group.dataset.testid = 'lang-toggle';
  const buttons = LOCALES.map((code) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lang-toggle__option';
    button.lang = code;
    button.dataset.locale = code;
    button.dataset.testid = `lang-${code}`;
    button.addEventListener('click', () => setLocale(code));
    group.append(button);
    return button;
  });
  const render = () => {
    group.setAttribute('aria-label', t('lang.label'));
    buttons.forEach((button) => {
      button.textContent = t(`lang.${button.dataset.locale}`);
      button.setAttribute('aria-pressed', String(button.dataset.locale === getLocale()));
    });
  };
  onLocaleChange(render);
  render();
  return group;
}

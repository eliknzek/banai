// BanAI logo: a wardrobe mark (two doors with pulls and an AI sparkle) plus a bold wordmark.
// Built as inline SVG so it needs no image file and scales crisply (CSP: no external assets).
// Colours come from the theme tokens (styles/tokens.css), so the logo follows the chosen theme.
const SVG_NS = 'http://www.w3.org/2000/svg';
let instance = 0;

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, String(value)));
  node.append(...children);
  return node;
}

export function createLogoMark({ size = 36 } = {}) {
  instance += 1;
  const gradientId = `logo-grad-${instance}`;
  const mark = svg('svg', { viewBox: '0 0 40 40', width: size, height: size, role: 'img', 'aria-label': 'BanAI', class: 'logo__mark' }, [
    svg('defs', {}, [
      svg('linearGradient', { id: gradientId, x1: 0, y1: 0, x2: 1, y2: 1 }, [
        svg('stop', { offset: '0%', style: 'stop-color: var(--theme-gradient-1)' }),
        svg('stop', { offset: '55%', style: 'stop-color: var(--theme-gradient-2)' }),
        svg('stop', { offset: '100%', style: 'stop-color: var(--theme-gradient-3)' }),
      ]),
    ]),
    svg('rect', { x: 1, y: 1, width: 38, height: 38, rx: 11, fill: `url(#${gradientId})` }),
    svg('rect', { x: 8, y: 9, width: 11, height: 23, rx: 2.5, style: 'fill: var(--theme-logo-door)' }),
    svg('rect', { x: 21, y: 9, width: 11, height: 23, rx: 2.5, style: 'fill: var(--theme-logo-door)' }),
    svg('rect', { x: 16, y: 18, width: 1.8, height: 6, rx: 0.9, style: 'fill: var(--theme-gradient-3)' }),
    svg('rect', { x: 22.2, y: 18, width: 1.8, height: 6, rx: 0.9, style: 'fill: var(--theme-gradient-3)' }),
    // AI sparkle, overlapping the top-right corner
    svg('path', { d: 'M33 1.5l1.7 4.3 4.3 1.7-4.3 1.7L33 13.5l-1.7-4.3-4.3-1.7 4.3-1.7z', style: 'fill: var(--theme-logo-sparkle); stroke: var(--theme-gradient-2)', 'stroke-width': 1, 'stroke-linejoin': 'round' }),
  ]);
  return mark;
}

/** Mark + wordmark. `tagline` is optional secondary text next to the wordmark. */
export function createLogo({ size = 36, tagline = '' } = {}) {
  const word = document.createElement('span');
  word.className = 'logo__word';
  const ban = document.createTextNode('Ban');
  const ai = document.createElement('span');
  ai.className = 'logo__ai';
  ai.textContent = 'AI';
  word.append(ban, ai);
  const root = document.createElement('span');
  root.className = 'logo';
  root.append(createLogoMark({ size }), word);
  if (tagline) {
    const note = document.createElement('span');
    note.className = 'logo__tagline';
    note.textContent = tagline;
    root.append(note);
  }
  return root;
}

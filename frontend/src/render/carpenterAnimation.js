// A friendly carpenter at work while the render is being made: the hammer swings, a small spark
// flashes on each hit, and a random piece of furniture builds up piece by piece, then starts over.
// Inline SVG (no assets, CSP 'self'), decorative only (aria-hidden): the status text next to it is
// what screen readers announce. prefers-reduced-motion shows the finished piece, standing still.

const NS = 'http://www.w3.org/2000/svg';

function node(tag, attrs = {}, children = []) {
  const element = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, String(value)));
  element.append(...children);
  return element;
}

// Each piece is a list of boards [x, y, width, height] on a 120 x 100 bench area, in build order.
export const FURNITURE = Object.freeze({
  chair: [[18, 70, 6, 26], [52, 70, 6, 26], [16, 64, 44, 7], [52, 30, 6, 36], [24, 34, 30, 5], [24, 46, 30, 5]],
  table: [[8, 52, 104, 8], [14, 60, 7, 36], [99, 60, 7, 36], [30, 60, 5, 30], [85, 60, 5, 30]],
  bookshelf: [[20, 10, 6, 86], [94, 10, 6, 86], [20, 10, 80, 6], [26, 34, 68, 5], [26, 58, 68, 5], [20, 90, 80, 6]],
  cabinet: [[16, 30, 88, 6], [16, 30, 6, 64], [98, 30, 6, 64], [16, 88, 88, 6], [24, 38, 34, 48], [62, 38, 34, 48]],
});
export const FURNITURE_KINDS = Object.freeze(Object.keys(FURNITURE));

/** The animated scene. `pick` chooses the piece (random by default, injectable for tests). */
export function createCarpenterAnimation({ pick = (kinds) => kinds[Math.floor(Math.random() * kinds.length)] } = {}) {
  const kind = pick(FURNITURE_KINDS);
  const boards = FURNITURE[kind].map(([x, y, w, h], i) => node('rect', {
    class: 'carpenter__board', x: 150 + x, y: 40 + y, width: w, height: h, rx: 1.5,
    style: `animation-delay: ${(i * 0.45).toFixed(2)}s`,
  }));

  const svg = node('svg', { viewBox: '0 0 300 150', class: 'carpenter', 'aria-hidden': 'true', focusable: 'false' }, [
    node('rect', { class: 'carpenter__floor', x: 0, y: 138, width: 300, height: 4, rx: 2 }),
    // Workbench
    node('rect', { class: 'carpenter__bench', x: 140, y: 134, width: 140, height: 6, rx: 2 }),
    node('g', { class: 'carpenter__piece', 'data-kind': kind }, boards),
    // The carpenter: legs, body, apron, head with a cap, and the swinging arm with the hammer
    node('rect', { class: 'carpenter__legs', x: 64, y: 104, width: 9, height: 34, rx: 3 }),
    node('rect', { class: 'carpenter__legs', x: 78, y: 104, width: 9, height: 34, rx: 3 }),
    node('rect', { class: 'carpenter__body', x: 58, y: 62, width: 36, height: 46, rx: 10 }),
    node('rect', { class: 'carpenter__apron', x: 64, y: 78, width: 24, height: 28, rx: 4 }),
    node('circle', { class: 'carpenter__head', cx: 76, cy: 48, r: 13 }),
    node('path', { class: 'carpenter__cap', d: 'M62 45 Q76 28 90 45 Z' }),
    node('circle', { class: 'carpenter__eye', cx: 81, cy: 48, r: 1.6 }),
    node('g', { class: 'carpenter__arm' }, [
      node('rect', { class: 'carpenter__sleeve', x: 88, y: 66, width: 34, height: 9, rx: 4.5 }),
      node('rect', { class: 'carpenter__handle', x: 118, y: 52, width: 5, height: 30, rx: 2 }),
      node('rect', { class: 'carpenter__hammer', x: 111, y: 46, width: 20, height: 10, rx: 2 }),
    ]),
    node('path', { class: 'carpenter__spark', d: 'M146 118 l3 -9 l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 z' }),
  ]);
  svg.dataset.kind = kind;
  return svg;
}

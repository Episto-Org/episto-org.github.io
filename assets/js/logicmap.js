// The logic map: a flag's logic tree drawn around its load-bearing claim.
// The claim the failure breaks sits at the centre, thickened, inside a
// hollow ring; what connects to it orbits on the ring, the rest further out.
// Arrows run from cause to effect; what falls with the centre is marked.

import { roleOf, nodeName, edgesOf, centerOf, fallsWith, notation, calcRows, ALLOWED_TO } from '../lib/logic.js';
import { pretty } from '../lib/mathcheck.js';
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const ROLE_NAME = { claim: 'Claim', cites: 'Another paper', calc: 'Calculation', fails: 'Failure', so: 'Consequence' };
const num = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6))));
const RING = 118;
const OUTER = 205;

function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function textOf(step, row) {
  if (step.calc !== undefined) {
    const known = row?.value !== null && row?.value !== undefined;
    // A line that only sets a number needs no result beside it.
    if (!known || /=\s*[-+]?[\d.]+\s*$/.test(step.calc)) return pretty(step.calc);
    return `${pretty(step.calc)} ${/=/.test(step.calc) ? '→' : '='} ${num(row.value)}`;
  }
  return step.claim ?? step.so ?? (step.cites ? `doi:${step.cites}${step.for ? ` (${step.for})` : ''}` : null);
}

/**
 * @param steps the logic tree
 * @param opts.failLabel the flag type's label, for the failure node
 * @param opts.selected node id to highlight ("1", "E2")
 * @param opts.onSelect called with a node id when a node is chosen
 * @param opts.help show the (?) that explains it (the builder has its own)
 * @returns an element: the map, the line of logic, and a key
 */
export function logicMap(steps, { failLabel = 'Failure', selected = null, onSelect = null, help = true } = {}) {
  const edges = edgesOf(steps);
  const calc = calcRows(steps).byStep;
  const ids = [...steps.map((_, i) => String(i + 1)), ...new Set(edges.flatMap((e) => [e.from, e.to]).filter((id) => id.startsWith('E')))];
  const center = centerOf(steps, edges) ?? ids[0];
  const falls = fallsWith(steps, edges);
  const name = (id) => (id.startsWith('E') ? id : nodeName(steps, Number(id) - 1));
  const near = ids.filter((id) => id !== center && edges.some((e) => (e.from === id && e.to === center) || (e.to === id && e.from === center)));
  const far = ids.filter((id) => id !== center && !near.includes(id));

  // The centre, the ring around it, and the rest placed near what they connect to.
  const pos = new Map([[center, [0, 0]]]);
  near.forEach((id, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / Math.max(near.length, 1);
    pos.set(id, [RING * Math.cos(a), RING * Math.sin(a)]);
  });
  far.forEach((id, k) => {
    const anchor = edges.find((e) => (e.from === id && pos.has(e.to)) || (e.to === id && pos.has(e.from)));
    const [ax, ay] = anchor ? pos.get(anchor.from === id ? anchor.to : anchor.from) : [0, -1];
    const base = Math.atan2(ay, ax) + (k % 2 ? 0.35 : -0.35) * Math.ceil((k + 1) / 2) * 0.5;
    pos.set(id, [OUTER * Math.cos(base), OUTER * Math.sin(base)]);
  });

  const map = svg('svg', { viewBox: '-250 -250 500 500', class: 'logic-map', role: 'img', 'aria-label': `Logic map. ${notation(steps, edges)}` });
  const defs = svg('defs');
  defs.append(
    Object.assign(svg('marker', { id: 'lm-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }), {}),
    svg('marker', { id: 'lm-tee', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto' }),
  );
  defs.firstChild.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'lm-head' }));
  defs.lastChild.append(svg('path', { d: 'M8,0 L8,10', class: 'lm-tee' }));
  map.append(defs, svg('circle', { cx: 0, cy: 0, r: RING, class: 'lm-ring' }));

  const radius = (id) => (id === center ? 36 : 24);
  for (const e of edges) {
    const [x1, y1] = pos.get(e.from);
    const [x2, y2] = pos.get(e.to);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
    map.append(svg('line', {
      x1: x1 + ux * radius(e.from), y1: y1 + uy * radius(e.from), x2: x2 - ux * (radius(e.to) + 3), y2: y2 - uy * (radius(e.to) + 3),
      class: `lm-edge lm-${e.kind}`, 'marker-end': e.kind === 'breaks' ? 'url(#lm-tee)' : 'url(#lm-arrow)',
    }));
  }
  for (const id of ids) {
    const [x, y] = pos.get(id);
    const role = id.startsWith('E') ? 'evidence' : roleOf(steps[Number(id) - 1]);
    const step = id.startsWith('E') ? null : steps[Number(id) - 1];
    const g = svg('g', {
      class: `lm-node lm-${role}${id === center ? ' lm-center' : ''}${falls.has(id) ? ' lm-falls' : ''}${calc.get(Number(id))?.parts ? ' lm-parts' : ''}${id === selected ? ' lm-selected' : ''}`,
      transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, tabindex: onSelect ? 0 : undefined, 'data-id': id,
    });
    g.append(
      svg('title', {}, `${name(id)}: ${id.startsWith('E') ? `evidence ${id.slice(1)}` : role === 'fails' ? failLabel : textOf(step, calc.get(Number(id)))}`),
      svg('circle', { r: radius(id) }),
      svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, `${name(id)}${calc.get(Number(id))?.parts ? '✗' : ''}`),
    );
    if (onSelect) {
      g.addEventListener('click', () => onSelect(id));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onSelect(id);
        }
      });
    }
    map.append(g);
  }

  const key = h('ol', { class: 'logic-key' }, steps.map((s, i) => {
    const role = roleOf(s);
    const id = String(i + 1);
    return h('li', { class: `${id === center ? 'is-center' : ''}${falls.has(id) ? ' is-falling' : ''}` },
      h('strong', null, `${name(id)} `), `${ROLE_NAME[role]}: `, role === 'fails' ? failLabel : textOf(s, calc.get(i + 1)),
      s.where ? h('span', { class: 'hint' }, ` · ${s.where}`) : null,
      s.why ? h('span', { class: 'hint' }, ` · ${s.why}`) : null,
      calc.get(i + 1)?.paper !== null && calc.get(i + 1)?.paper !== undefined
        ? h('span', { class: calc.get(i + 1).parts ? 'parts' : 'hint' }, calc.get(i + 1).parts
          ? ` ✗ the paper has ${num(calc.get(i + 1).paper)}${s.error ? `: ${s.error}` : ''}`
          : ` ✓ the paper agrees (${num(calc.get(i + 1).paper)})`)
        : null,
      id === center ? h('span', { class: 'hint' }, ' · load-bearing') : falls.has(id) ? h('span', { class: 'hint' }, ' · falls with it') : null);
  }));
  return h('div', { class: 'logic-map-box stack' }, help ? logicHelp() : null, map, h('p', { class: 'logic-line' }, h('code', null, notation(steps, edges))), key);
}

/**
 * The small (?) that explains why a logic tree, and says plainly that it
 * is open data anyone may use, machine-learning companies included.
 */
export function logicHelp() {
  return h('details', { class: 'help' },
    h('summary', { 'aria-label': 'How to read the logic map' }, '?'),
    h('div', { class: 'stack' },
      h('p', null, h('strong', null, 'How to read it')),
      h('ul', null,
        h('li', null, h('strong', null, 'Centre: '), 'the load-bearing claim, the one the flag breaks.'),
        h('li', null, h('strong', null, 'Arrows '), 'run from cause to effect: → supports, ⊣ breaks, ⊢ shows.'),
        h('li', null, h('strong', null, 'Letters: '), 'C claim, P another paper, M calculation, F the failure, S what follows, E evidence.'),
        h('li', null, h('strong', null, '✗ '), 'marks the calculation line where the paper\'s number or formula parts from the calculation: where the mistake happens. The machine checks it.'),
        h('li', null, h('strong', null, 'Dashed red: '), 'falls with the centre.'),
        h('li', null, h('strong', null, 'Select a step '), 'to see what it can connect to.')),
      h('p', null, 'The line under the map says the same in logic: after ∴, what falls.'),
      h('p', { class: 'hint' }, 'Open data (CC0) in the public database, free for any use, machine learning included.')));
}

/** Step numbers a step may point to, by role. */
export function targetsFor(steps, i) {
  const role = roleOf(steps[i]);
  return steps.map((s, j) => j).filter((j) => j !== i && ALLOWED_TO[role]?.includes(roleOf(steps[j]))).map((j) => j + 1);
}

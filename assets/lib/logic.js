// Logic trees: the shape of a flag's argument, shared by the steward, the
// site and the meta export.
//
// Steps are numbered from 1. Arrows go from cause to effect:
//   supports (→)  a claim, another paper or an evidence item holds up a claim;
//                 a claim leads to a consequence
//   breaks   (⊣)  the failure breaks the claim it lands on
//   shows    (⊢)  evidence, or the calculation line where the paper's version
//                 parts from the calculation, shows the failure
// Calculation steps (M) are linked by the names their formulas use.
// The claim the failure breaks is load-bearing: everything downstream of it
// along "supports" falls with it.

import { checkDerivation } from './mathcheck.js';

export const ROLE_LETTER = { claim: 'C', cites: 'P', calc: 'M', fails: 'F', so: 'S' };

/** What each role may point to (the roles of the targets). */
export const ALLOWED_TO = {
  calc: ['calc', 'claim'],
  claim: ['claim', 'so'],
  cites: ['claim'],
  fails: ['claim'],
  so: ['so'],
};

export function roleOf(step) {
  return Object.keys(ROLE_LETTER).find((r) => step && typeof step === 'object' && r in step) ?? null;
}

export function nodeName(steps, i) {
  return `${ROLE_LETTER[roleOf(steps[i])]}${i + 1}`;
}

/**
 * The spine: claims marked central, in their order. Together they are the
 * machine the paper builds, each holding up the next; a failure on one
 * brings down every later one.
 * @returns step numbers as strings, in spine order
 */
export function spineOf(steps) {
  return steps.map((s, i) => [s, i]).filter(([s]) => roleOf(s) === 'claim' && Number.isInteger(s.central))
    .sort((a, b) => a[0].central - b[0].central).map(([, i]) => String(i + 1));
}

/** The calculation steps checked together: rows by step number. */
export function calcRows(steps) {
  const at = steps.map((s, i) => (roleOf(s) === 'calc' ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return { byStep: new Map(), problems: [], first: null };
  const { rows, problems, first } = checkDerivation(at.map((i) => ({ expr: steps[i].calc, paper: steps[i].paper })));
  const byStep = new Map(at.map((i, k) => [i + 1, { ...rows[k], uses: rows[k].uses.map((u) => at[u - 1] + 1) }]));
  return { byStep, problems: problems.map((p) => p.replace(/calculation line (\d+)/, (_, k) => `logic ${at[Number(k) - 1] + 1}`)), first: first ? at[first - 1] + 1 : null };
}

/**
 * Every arrow, with the defaults older trees rely on: a failure without a
 * target breaks the first claim; another paper without a target supports
 * the nearest claim before it; a consequence nothing points to follows from
 * the load-bearing claim.
 * @returns {{from: string, to: string, kind: 'supports'|'breaks'|'shows'}[]}
 *   node ids: "1", "2"... for steps, "E1"... for evidence
 */
export function edgesOf(steps) {
  const edges = [];
  const claims = steps.map((s, i) => (roleOf(s) === 'claim' ? i : -1)).filter((i) => i >= 0);
  steps.forEach((s, i) => {
    const role = roleOf(s);
    const id = String(i + 1);
    for (const e of s.rests_on ?? []) edges.push({ from: `E${e}`, to: id, kind: 'supports' });
    for (const e of s.because ?? []) edges.push({ from: `E${e}`, to: id, kind: 'shows' });
    let to = s.to;
    if (!to?.length) {
      if (role === 'fails' && claims.length) to = [claims[0] + 1];
      if (role === 'cites') {
        const before = claims.filter((c) => c < i);
        if (before.length || claims.length) to = [(before.length ? before.at(-1) : claims[0]) + 1];
      }
    }
    for (const t of to ?? []) edges.push({ from: id, to: String(t), kind: role === 'fails' ? 'breaks' : 'supports' });
  });
  // The spine: each central claim holds up the next.
  const spine = spineOf(steps);
  for (let k = 1; k < spine.length; k++) {
    if (!edges.some((e) => e.from === spine[k - 1] && e.to === spine[k])) edges.push({ from: spine[k - 1], to: spine[k], kind: 'supports' });
  }
  // Calculations: each line from the lines whose names it uses; the lines
  // where the paper parts from the calculation show the failure.
  const { byStep } = calcRows(steps);
  const failSteps = steps.map((s, i) => (roleOf(s) === 'fails' ? String(i + 1) : null)).filter(Boolean);
  for (const [n, row] of byStep) {
    for (const u of row.uses) edges.push({ from: String(u), to: String(n), kind: 'supports' });
    if (row.parts) for (const f of failSteps) edges.push({ from: String(n), to: f, kind: 'shows' });
  }
  const center = centerOf(steps, edges);
  steps.forEach((s, i) => {
    const id = String(i + 1);
    if (roleOf(s) === 'so' && center && !edges.some((e) => e.to === id)) edges.push({ from: center, to: id, kind: 'supports' });
  });
  return edges;
}

/** The load-bearing claim: the one the failure breaks. */
export function centerOf(steps, edges = edgesOf(steps)) {
  return edges.find((e) => e.kind === 'breaks')?.to ?? null;
}

/** Steps that fall with the load-bearing claim (downstream along "supports"). */
export function fallsWith(steps, edges = edgesOf(steps)) {
  const center = centerOf(steps, edges);
  const out = new Set();
  const walk = (id) => {
    for (const e of edges) if (e.from === id && e.kind === 'supports' && !out.has(e.to)) {
      out.add(e.to);
      walk(e.to);
    }
  };
  if (center) walk(center);
  return out;
}

/** True when the "supports" and "breaks" arrows between steps have no cycle. */
export function acyclic(steps, edges = edgesOf(steps)) {
  const next = new Map();
  for (const e of edges) if (!e.from.startsWith('E')) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map();
  const visit = (n) => {
    if (state.get(n) === 1) return false;
    if (state.get(n) === 2) return true;
    state.set(n, 1);
    for (const m of next.get(n) ?? []) if (!visit(m)) return false;
    state.set(n, 2);
    return true;
  };
  return steps.every((_, i) => visit(String(i + 1)));
}

/**
 * The tree as one line of logic, e.g.
 * "E2 → C1; P2 → C1; E1 ⊢ F3; F3 ⊣ C1; C1 → S4 ∴ ¬C1 ⇒ ¬S4"
 */
export function notation(steps, edges = edgesOf(steps)) {
  const { byStep } = calcRows(steps);
  const name = (id) => (id.startsWith('E') ? id : `${nodeName(steps, Number(id) - 1)}${byStep.get(Number(id))?.parts ? '✗' : ''}`);
  const sym = { supports: '→', breaks: '⊣', shows: '⊢' };
  const parts = edges.map((e) => `${name(e.from)} ${sym[e.kind]} ${name(e.to)}`);
  const center = centerOf(steps, edges);
  if (!center) return parts.join('; ');
  const falls = [...fallsWith(steps, edges)].map(name);
  return `${parts.join('; ')} ∴ ¬${name(center)}${falls.length ? ` ⇒ ${falls.map((f) => `¬${f}`).join(' ∧ ')}` : ''}`;
}

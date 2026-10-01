// Shared by the join and account pages: the review pools, the lottery
// explained, the pool chooser, and members.yaml entries in and out.

import { h } from './dom.js';

export async function loadPoolsConfig() {
  const res = await fetch(new URL('../../data/pools.json', import.meta.url), { credentials: 'omit' });
  if (!res.ok) throw new Error(`Could not load the pools (${res.status})`);
  return res.json();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day a pool choice starts to count (same rule as tools/lib/members.mjs). */
export function effectiveDay(joined, chosen, cfg) {
  return chosen <= addDays(joined, cfg.newMemberDays) ? chosen : addDays(chosen, cfg.choiceDelayDays);
}

export function isMethod(cfg, pool) {
  return cfg.methods.some((m) => m.id === pool);
}

export function poolLabel(cfg, pool) {
  return cfg.methods.find((m) => m.id === pool)?.label ?? pool;
}

/** How the lottery uses pools, with the numbers from pools.yaml. */
export function explainer(cfg) {
  const a = cfg.activation;
  return h('details', { class: 'panel' },
    h('summary', null, h('strong', null, 'How pools and the lottery work')),
    h('div', { class: 'stack' },
      h('p', null, 'Nobody chooses reviewers. When a flag needs a panel, seats are drawn by lottery from the pools that its type of problem needs: a p-value problem draws mostly from Statistics and from the paper\'s field, an undisclosed conflict of interest mostly from Documents and disclosure. The draw uses a public random beacon, so anyone can replay it, and no two seats go to people invited by the same member.'),
      h('p', null, `Choose pools you can judge well: up to ${cfg.limits.methods} methods pools (how research is done) and up to ${cfg.limits.fields} research fields (what it is about). A reviewer who does not know a method slows a panel down and can be misled; choosing fewer pools well is better than many.`),
      h('p', null, `Pool choices made in your first ${cfg.newMemberDays} days count at once. After that, a new choice counts ${cfg.choiceDelayDays} days after you make it, so nobody can join a pool to land on a particular case. Leaving a pool counts at once; joining it again starts the wait again.`),
      h('p', null, `A pool is used on its own once ${a.active_members} members who reviewed in the last ${a.active_window_months} months hold it, invited through at least ${a.invite_branches} different branches. Until then its seats are drawn from it together with closely related pools, never from unrelated ones. A psychologist is not drawn for a physics paper.`),
      h('p', null, 'Now and then a panel is a calibration case with a known answer. Results are pass or fail and private. Members whose recent answers in a pool fall below the floor sit out that pool until they answer two in a row correctly. Nothing is ranked, and no score is shown.'),
    ));
}

/**
 * Checkboxes for methods pools and fields, keeping to the limits.
 * @param selected Set of pool ids (field pools are field names)
 */
export function picker(cfg, selected, onChange) {
  const boxes = [];
  const count = () => {
    let methods = 0;
    let fields = 0;
    for (const p of selected) (isMethod(cfg, p) ? methods++ : fields++);
    return { methods, fields };
  };
  const refresh = () => {
    const c = count();
    for (const { input, method } of boxes) {
      input.disabled = !input.checked && (method ? c.methods >= cfg.limits.methods : c.fields >= cfg.limits.fields);
    }
    methodsCount.textContent = `${c.methods} of ${cfg.limits.methods} chosen`;
    fieldsCount.textContent = `${c.fields} of ${cfg.limits.fields} chosen`;
  };
  const box = (pool, method, ...label) => {
    const input = h('input', { type: 'checkbox', value: pool });
    input.checked = selected.has(pool);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(pool);
      else selected.delete(pool);
      refresh();
      onChange();
    });
    boxes.push({ input, method });
    return h('label', { class: 'check' }, input, ...label);
  };
  const methodsCount = h('span', { class: 'hint' });
  const fieldsCount = h('span', { class: 'hint' });
  const el = h('div', { class: 'stack' },
    h('fieldset', null,
      h('legend', null, h('strong', null, 'Methods pools'), ' ', methodsCount),
      h('div', { class: 'types' }, cfg.methods.map((m) => box(m.id, true, h('span', null, h('strong', null, m.label), h('br'), h('span', { class: 'hint' }, m.covers)))))),
    h('fieldset', null,
      h('legend', null, h('strong', null, 'Research fields'), ' ', fieldsCount),
      cfg.domains.map((d) => h('details', { open: d.fields.some((f) => selected.has(f)) },
        h('summary', null, d.label),
        h('div', { class: 'types' }, d.fields.map((f) => box(f, false, f)))))),
  );
  refresh();
  return el;
}

// ------------------------------------------------------------ members.yaml entries

const ORDER = ['pseudonym', 'forge', 'key', 'invited_by', 'pools', 'joined', 'status', 'roles', 'can_invite'];

function scalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^[a-z0-9][a-z0-9-]*$/.test(v) && !['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(v)) return v;
  return JSON.stringify(v);
}

function key(k) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(k) ? k : JSON.stringify(k);
}

/** One members.yaml list item, indented as in the file. */
export function entryYaml(entry) {
  const lines = [];
  const keys = [...ORDER.filter((k) => k in entry), ...Object.keys(entry).filter((k) => !ORDER.includes(k))];
  for (const k of keys) {
    const v = entry[k];
    if (v === undefined) continue;
    if (v && typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [kk, vv] of Object.entries(v)) lines.push(`  ${key(kk)}: ${scalar(vv)}`);
    } else {
      lines.push(`${k}: ${scalar(v)}`);
    }
  }
  return lines.map((l, i) => (i === 0 ? `  - ${l}` : `    ${l}`)).join('\n') + '\n';
}

function unquote(text) {
  const t = text.trim();
  if (t.startsWith('"')) return JSON.parse(t);
  if (t.startsWith("'")) {
    if (!t.endsWith("'") || t.length < 2) throw new Error('unclosed quote');
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t === 'null' || t === '~' || t === '') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.startsWith('{') || t.startsWith('[')) throw new Error('write maps one entry per line');
  return t.replace(/\s+#.*$/, '');
}

function splitKey(line) {
  const t = line.trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0];
    let i = 1;
    while (i < t.length && !(t[i] === q && t[i - 1] !== '\\')) i++;
    if (t[i + 1] !== ':') throw new Error(`cannot read "${t}"`);
    return [unquote(t.slice(0, i + 1)), t.slice(i + 2)];
  }
  const at = t.indexOf(':');
  if (at < 1) throw new Error(`cannot read "${t}"`);
  return [t.slice(0, at).trim(), t.slice(at + 1)];
}

/**
 * Reads one members.yaml entry, as copied from the file. Handles the plain
 * layout the file uses (one key per line, pools and roles as nested maps).
 */
export function parseEntry(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) throw new Error('nothing to read');
  lines[0] = lines[0].replace(/^(\s*)- /, (_, sp) => `${sp}  `);
  const base = lines[0].search(/\S/);
  const entry = {};
  let nested = null;
  for (const line of lines) {
    const indent = line.search(/\S/);
    if (line.trim().startsWith('- ')) throw new Error('paste one entry only');
    const [k, rest] = splitKey(line);
    if (indent > base) {
      if (!nested) throw new Error(`"${k}" is indented but belongs to nothing`);
      nested[k] = unquote(rest);
    } else if (indent === base) {
      if (rest.trim() === '') {
        nested = entry[k] = {};
      } else {
        nested = null;
        entry[k] = unquote(rest);
      }
    } else {
      throw new Error('the indentation is uneven; copy the entry as it is in the file');
    }
  }
  if (typeof entry.pseudonym !== 'string') throw new Error('the entry has no pseudonym');
  return entry;
}

export function listPools(cfg, pools, joined) {
  const rows = Object.entries(pools).sort(([a], [b]) => (isMethod(cfg, b) - isMethod(cfg, a)) || a.localeCompare(b));
  return h('ul', null, rows.map(([pool, chosen]) => {
    const from = effectiveDay(joined, chosen, cfg);
    return h('li', null, h('strong', null, poolLabel(cfg, pool)), ` chosen ${chosen}, `, from <= today() ? 'counts now' : `counts from ${from}`);
  }));
}

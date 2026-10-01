// Browse and search flagged papers. All filters live in the URL.

import { normalizeTitle } from '../lib/text.js';
import { h, $, clear, severityChip, getParams, setParams, status } from './dom.js';
import { loadBrowse, loadTaxonomy, taxonomyLookup, parseFlagKey } from './data.js';

const PAGE = 50;
const RANK = { critical: 3, major: 2, caution: 1, propagated: 0 };
let rows = [];
let search = []; // normalised search text per row
let lookup;
let taxonomy;
let domains = [];

const params = () => getParams();

function readFilters() {
  const p = params();
  return {
    q: p.get('q') ?? '',
    category: p.get('category') ?? '',
    type: p.get('type') ?? '',
    severity: (p.get('severity') ?? '').split(',').filter(Boolean),
    source: p.get('source') ?? '',
    status: p.get('status') ?? '',
    domain: p.get('domain') ?? '',
    field: p.get('field') ?? '',
    from: Number(p.get('from')) || null,
    to: Number(p.get('to')) || null,
    sort: p.get('sort') ?? 'flagged',
    page: Math.max(1, Number(p.get('page')) || 1),
  };
}

function writeFilters(f) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v) ? v.length : v && !(k === 'sort' && v === 'flagged') && !(k === 'page' && v === 1)) {
      p.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
  }
  setParams(p);
}

function keysOf(r, withdrawn) {
  return withdrawn ? r.w : r.k.map((k) => parseFlagKey(k).key);
}

function matches(r, i, f, words) {
  const withdrawn = f.status === 'withdrawn';
  if (withdrawn && r.w.length === 0) return false;
  if (!withdrawn && !r.s) return false;
  const keys = keysOf(r, withdrawn);
  if (f.type && !keys.includes(f.type)) return false;
  if (f.category && !keys.some((k) => k.startsWith(f.category + '.'))) return false;
  if (f.severity.length && !f.severity.includes(r.s)) return false;
  if (f.source && !r.src.includes(f.source)) return false;
  if (f.domain && !r.dm.includes(f.domain)) return false;
  if (f.field && r.f !== f.field) return false;
  if (f.from && !(r.y >= f.from)) return false;
  if (f.to && !(r.y <= f.to)) return false;
  for (const w of words) if (!search[i].includes(w)) return false;
  return true;
}

const SORTS = {
  flagged: (a, b) => (b.dt ?? '').localeCompare(a.dt ?? ''),
  severity: (a, b) => (RANK[b.s] ?? -1) - (RANK[a.s] ?? -1) || (b.dt ?? '').localeCompare(a.dt ?? ''),
  year: (a, b) => (b.y ?? 0) - (a.y ?? 0),
  title: (a, b) => (a.t ?? '').localeCompare(b.t ?? ''),
};

function update() {
  const f = readFilters();
  syncControls(f);
  const words = normalizeTitle(f.q).split(' ').filter(Boolean);
  const hits = [];
  rows.forEach((r, i) => {
    if (matches(r, i, f, words)) hits.push(r);
  });
  hits.sort(SORTS[f.sort] ?? SORTS.flagged);

  const pages = Math.max(1, Math.ceil(hits.length / PAGE));
  const page = Math.min(f.page, pages);
  $('#count').textContent = `${hits.length.toLocaleString()} paper${hits.length === 1 ? '' : 's'}`;
  const list = clear($('#list'));
  for (const r of hits.slice((page - 1) * PAGE, page * PAGE)) list.appendChild(item(r, f));
  if (hits.length === 0) list.appendChild(h('li', null, 'Nothing matches these filters.'));

  const pager = clear($('#pager'));
  if (pages > 1) {
    const go = (n) => () => {
      writeFilters({ ...readFilters(), page: n });
      update();
      $('#count').scrollIntoView({ block: 'start' });
    };
    const prev = h('button', { type: 'button', disabled: page === 1 }, 'Previous');
    const next = h('button', { type: 'button', disabled: page === pages }, 'Next');
    prev.addEventListener('click', go(page - 1));
    next.addEventListener('click', go(page + 1));
    pager.append(prev, h('span', null, `Page ${page} of ${pages}`), next);
  }
  renderTiles(f);
}

function item(r, f) {
  const keys = f.status === 'withdrawn' ? r.w.map((k) => ({ key: k, severity: null })) : r.k.map(parseFlagKey);
  const meta = [r.a, r.j, r.y].filter(Boolean).join(' · ');
  return h(
    'li',
    null,
    h('div', { class: 'result-head' }, severityChip(r.s), h('a', { href: `paper.html?id=${encodeURIComponent(r.i)}` }, r.t || r.d || r.i)),
    meta ? h('p', { class: 'meta' }, meta) : null,
    h(
      'p',
      { class: 'note' },
      keys.map(({ key }) => h('a', { class: 'tag', href: `guide.html#${key}` }, lookup.types.get(key)?.label ?? key)),
      r.p ? h('span', { class: 'tag' }, `Cites ${r.p} flagged paper${r.p === 1 ? '' : 's'}`) : null,
      r.src.includes('community') ? h('span', { class: 'badge' }, 'Community flag') : null,
    ),
  );
}

function renderTiles(f) {
  const tiles = clear($('#tiles'));
  if (f.category || f.q || f.type) {
    tiles.hidden = true;
    return;
  }
  tiles.hidden = false;
  const counts = new Map(taxonomy.categories.map((c) => [c.id, { critical: 0, major: 0, caution: 0, total: 0 }]));
  for (const r of rows) {
    const seen = new Set();
    for (const k of r.k) {
      const { key, severity } = parseFlagKey(k);
      const cat = key.split('.')[0];
      if (seen.has(cat)) continue;
      seen.add(cat);
      const c = counts.get(cat);
      if (!c) continue;
      c.total++;
      if (c[severity] !== undefined) c[severity]++;
    }
  }
  for (const cat of taxonomy.categories) {
    const c = counts.get(cat.id);
    const bar = h('span', { class: 'bar', 'aria-hidden': 'true' });
    for (const sev of ['critical', 'major', 'caution']) {
      if (c[sev]) {
        const seg = h('i', { class: `b-${sev}` });
        seg.style.width = `${(100 * c[sev]) / c.total}%`;
        bar.appendChild(seg);
      }
    }
    const tile = h(
      'a',
      { class: 'tile', href: `?category=${cat.id}` },
      h('strong', null, cat.label),
      h('span', { class: 'q' }, cat.question),
      bar,
      h('span', { class: 'count' }, `${c.total.toLocaleString()} paper${c.total === 1 ? '' : 's'}`),
    );
    tile.addEventListener('click', (e) => {
      e.preventDefault();
      writeFilters({ ...readFilters(), category: cat.id, type: '', page: 1 });
      update();
    });
    tiles.appendChild(tile);
  }
}

function fillSelect(select, options) {
  const first = select.options[0];
  clear(select).appendChild(first);
  for (const [value, label] of options) select.appendChild(h('option', { value }, label));
}

function syncControls(f) {
  $('#q').value !== f.q && ($('#q').value = f.q);
  $('#f-category').value = f.category;
  const types = f.category
    ? lookup.categories.get(f.category)?.types.map((t) => [`${f.category}.${t.id}`, t.label]) ?? []
    : [];
  const typeSelect = $('#f-type');
  if (typeSelect.dataset.for !== f.category) {
    fillSelect(typeSelect, types);
    typeSelect.dataset.for = f.category;
  }
  typeSelect.value = f.type;
  typeSelect.disabled = !f.category;
  for (const box of document.querySelectorAll('#f-severity input')) box.checked = f.severity.includes(box.value);
  $('#f-source').value = f.source;
  $('#f-status').value = f.status;
  $('#f-domain').value = f.domain;
  $('#f-field').value = f.field;
  $('#f-from').value = f.from ?? '';
  $('#f-to').value = f.to ?? '';
  $('#sort').value = f.sort;
}

function bind() {
  const set = (patch) => {
    writeFilters({ ...readFilters(), ...patch, page: 1 });
    update();
  };
  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => set({ q: e.target.value.trim() }), 150);
  });
  $('#f-category').addEventListener('change', (e) => set({ category: e.target.value, type: '' }));
  $('#f-type').addEventListener('change', (e) => set({ type: e.target.value }));
  $('#f-severity').addEventListener('change', () =>
    set({ severity: [...document.querySelectorAll('#f-severity input:checked')].map((b) => b.value) }),
  );
  $('#f-source').addEventListener('change', (e) => set({ source: e.target.value }));
  $('#f-status').addEventListener('change', (e) => set({ status: e.target.value }));
  $('#f-domain').addEventListener('change', (e) => set({ domain: e.target.value }));
  $('#f-field').addEventListener('change', (e) => set({ field: e.target.value }));
  $('#f-from').addEventListener('change', (e) => set({ from: Number(e.target.value) || null }));
  $('#f-to').addEventListener('change', (e) => set({ to: Number(e.target.value) || null }));
  $('#sort').addEventListener('change', (e) => set({ sort: e.target.value }));
  $('#filters').addEventListener('reset', (e) => {
    e.preventDefault();
    setParams(new URLSearchParams());
    update();
  });
  window.addEventListener('popstate', update);
  if (window.matchMedia('(max-width: 760px)').matches) $('#filter-box').open = false;
}

async function init() {
  try {
    const [data, tax] = await Promise.all([loadBrowse(), loadTaxonomy()]);
    rows = data.papers;
    taxonomy = tax;
    domains = tax.domains;
    lookup = taxonomyLookup(tax);
  } catch (e) {
    status($('#list'), `The flag list could not be loaded: ${e.message}`, 'error');
    return;
  }
  search = rows.map((r) => normalizeTitle([r.t, r.a, r.j, r.d].filter(Boolean).join(' ')));
  fillSelect($('#f-category'), taxonomy.categories.map((c) => [c.id, c.label]));
  fillSelect($('#f-domain'), domains.map((d) => [d.id, d.label]));
  fillSelect($('#f-field'), domains.flatMap((d) => d.fields).sort().map((f) => [f, f]));
  bind();
  update();
}

init();

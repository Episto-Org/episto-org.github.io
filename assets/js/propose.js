// The flag builder: a form that writes a valid flag file.

import { logicMap, targetsFor } from './logicmap.js';
import { normalizeDoi, doiSlug } from '../lib/doi.js';
import { h, $, clear, severityChip, download } from './dom.js';
import { loadTaxonomy } from './data.js';

let tax;
let current = null; // selected type
let category = null;

// ------------------------------------------------------------ YAML output
// JSON strings are valid YAML scalars, so every string is written as JSON.

function yamlScalar(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (/^[a-z][a-z0-9-]*$/.test(v) && !['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(v)) return v;
  return JSON.stringify(v);
}

function toYaml(value, indent = '') {
  const out = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push(`${indent}${k}: []`);
        continue;
      }
      out.push(`${indent}${k}:`);
      for (const item of v) {
        if (typeof item === 'object') {
          const lines = toYaml(item, `${indent}    `).split('\n');
          out.push(`${indent}  - ${lines[0].trimStart()}`, ...lines.slice(1));
        } else {
          out.push(`${indent}  - ${yamlScalar(item)}`);
        }
      }
    } else if (typeof v === 'object' && v !== null) {
      out.push(`${indent}${k}:`, toYaml(v, `${indent}  `));
    } else {
      out.push(`${indent}${k}: ${yamlScalar(v)}`);
    }
  }
  return out.join('\n');
}

// ------------------------------------------------------------ the form

async function lookup() {
  const doi = normalizeDoi($('#doi').value);
  const status = $('#lookup-status');
  if (!doi) {
    status.textContent = 'That does not look like a DOI.';
    return;
  }
  status.textContent = 'Looking up…';
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(res.status === 404 ? 'not found at Crossref' : `HTTP ${res.status}`);
    const w = (await res.json()).message;
    $('#title').value = (w.title?.[0] ?? '').replace(/\s+/g, ' ').trim();
    $('#authors').value = (w.author ?? []).map((a) => [a.family, a.given].filter(Boolean).join(' ') || a.name).filter(Boolean).join('\n');
    $('#year').value = w.issued?.['date-parts']?.[0]?.[0] ?? '';
    $('#journal').value = w['container-title']?.[0] ?? '';
    status.textContent = 'Filled in from Crossref. Check it.';
  } catch (e) {
    status.textContent = `Lookup failed (${e.message}). Fill in the fields by hand.`;
  }
  update();
}

function renderCategories() {
  const box = clear($('#categories'));
  for (const c of tax.categories) {
    const tile = h('button', { type: 'button', class: 'tile', role: 'radio', 'aria-checked': String(category?.id === c.id) },
      h('strong', null, c.label), h('span', { class: 'q' }, c.question));
    tile.addEventListener('click', () => {
      category = c;
      current = null;
      renderCategories();
      renderTypes();
      renderEvidence();
      update();
    });
    box.appendChild(tile);
  }
}

function renderTypes() {
  const box = clear($('#types'));
  clear($('#type-info'));
  if (!category) return;
  const list = h('div', { class: 'types', role: 'radiogroup', 'aria-label': 'Type' });
  for (const t of category.types) {
    const input = h('input', { type: 'radio', name: 'type', value: t.id, checked: current?.id === t.id });
    input.addEventListener('change', () => {
      current = t;
      renderTypeInfo();
      renderEvidence();
      update();
    });
    list.appendChild(h('label', null, input, h('span', null, h('strong', null, t.label), ` · ${t.description}`)));
  }
  box.appendChild(list);
  renderTypeInfo();
}

function renderTypeInfo() {
  const box = clear($('#type-info'));
  if (!current) return;
  box.append(h('p', null, 'Allowed severities: ', current.severity.map((s) => [severityChip(s), ' '])));
  if (current.not_enough) {
    box.append(h('div', { class: 'notice' }, h('strong', null, 'Not enough on its own'), h('ul', null, current.not_enough.map((n) => h('li', null, n)))));
  }
}

function renderEvidence() {
  const box = clear($('#evidence'));
  if (!current) {
    box.appendChild(h('p', { class: 'hint' }, 'Choose what is wrong first.'));
    return;
  }
  current.evidence.forEach((item, i) => {
    const alt = /^Or\b/.test(item) || /^Or\b/.test(current.evidence[i + 1] ?? '');
    box.appendChild(
      h('div', { class: 'evidence-item stack', 'data-item': i + 1 },
        h('p', null, h('strong', null, `${i + 1}. ${item}`), alt ? h('span', { class: 'hint' }, ' (answer at least one of the alternatives)') : null),
        h('label', { for: `ev-text-${i}` }, 'What it shows'),
        h('textarea', { id: `ev-text-${i}`, class: 'short' }),
        h('label', { for: `ev-urls-${i}` }, 'Links ', h('span', { class: 'hint' }, 'one per line')),
        h('textarea', { id: `ev-urls-${i}`, class: 'short', spellcheck: 'false' }),
        h('label', { for: `ev-files-${i}` }, 'Evidence file names ', h('span', { class: 'hint' }, 'comma-separated, e.g. grim.csv. Images and PDFs are excerpts: crop to what the flag needs, at most 10 pages for the whole flag.')),
        h('input', { id: `ev-files-${i}`, type: 'text', class: 'wide', spellcheck: 'false' }),
        h('label', { for: `ev-quote-${i}` }, 'Quote from the paper ', h('span', { class: 'hint' }, 'optional, word for word; at most 300 words for the whole flag')),
        h('textarea', { id: `ev-quote-${i}`, class: 'short' }),
        h('label', { for: `ev-page-${i}` }, 'Where in the paper ', h('span', { class: 'hint' }, 'page, figure or table; needed for a quote, an image or a PDF')),
        h('input', { id: `ev-page-${i}`, type: 'text', class: 'wide' }),
      ),
    );
  });
}

// The optional logic tree: one row per step.
const STEP_FIELDS = {
  claim: [['claim', 'Claims (your own words)'], ['where', 'Where (page, section, figure or table)'], ['rests_on', 'Resting on evidence (numbers, optional)']],
  cites: [['cites', 'Rests on the paper with DOI'], ['for', 'For what (optional)']],
  fails: [['because', 'Fails because of evidence (numbers)']],
  so: [['so', 'So (what falls with it)']],
};

const ROLE_TITLE = { claim: 'Claims', cites: 'Rests on another paper', fails: 'Fails', so: 'So' };
const LETTER = { claim: 'C', cites: 'P', fails: 'F', so: 'S' };
let selectedStep = null;

function addStep(kind) {
  const row = h('div', { class: 'logic-step stack', 'data-kind': kind },
    h('p', null, h('strong', { class: 'step-name' }, ''), ` ${ROLE_TITLE[kind]}`),
    ...STEP_FIELDS[kind].map(([name, label]) => h('label', null, label, h('input', { type: 'text', 'data-name': name, autocomplete: 'off' }))),
    h('div', { class: 'arrows stack' }));
  const remove = h('button', { type: 'button' }, 'Remove');
  remove.addEventListener('click', () => {
    row.remove();
    refreshLogic();
    update();
  });
  row.append(remove);
  row.addEventListener('input', (ev) => {
    if (ev.target.type !== 'checkbox') refreshLogic(false);
    else refreshLogic();
    update();
  });
  $('#logic').append(row);
  refreshLogic();
  update();
}

/** Steps as written so far, with their arrows (for the map, before checking). */
function draftSteps() {
  const numbers = (v) => v.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger);
  return [...document.querySelectorAll('#logic .logic-step')].map((row) => {
    const get = (name) => row.querySelector(`[data-name="${name}"]`)?.value.trim() ?? '';
    const to = [...row.querySelectorAll('.arrows input:checked')].map((c) => Number(c.value));
    const arrows = to.length ? { to } : {};
    const kind = row.dataset.kind;
    if (kind === 'claim') return { claim: get('claim'), where: get('where'), ...(get('rests_on') ? { rests_on: numbers(get('rests_on')) } : {}), ...arrows };
    if (kind === 'cites') return { cites: get('cites'), ...(get('for') ? { for: get('for') } : {}), ...arrows };
    if (kind === 'fails') return { fails: `${category?.id}.${current?.id}`, because: numbers(get('because')), ...arrows };
    return { so: get('so'), ...arrows };
  });
}

/**
 * Names each step (C1, P2, F3...), offers on each only the arrows its role
 * allows, and redraws the map. `arrows` false keeps the checkboxes as they
 * are (while typing).
 */
function refreshLogic(arrows = true) {
  const rows = [...document.querySelectorAll('#logic .logic-step')];
  const steps = draftSteps();
  rows.forEach((row, i) => {
    row.querySelector('.step-name').textContent = `${LETTER[row.dataset.kind]}${i + 1}`;
    row.classList.toggle('is-selected', selectedStep === String(i + 1));
    if (!arrows) return;
    const box = clear(row.querySelector('.arrows'));
    const allowed = targetsFor(steps, i);
    const chosen = new Set(steps[i].to ?? []);
    const word = row.dataset.kind === 'fails' ? 'Breaks' : 'Points to';
    if (!allowed.length) return box.append(h('p', { class: 'hint' }, row.dataset.kind === 'fails' ? 'Add the claim it breaks.' : 'Nothing to point to yet.'));
    box.append(h('p', { class: 'hint' }, `${word} (optional):`), h('div', { class: 'row' }, allowed.map((n) => h('label', null,
      h('input', { type: row.dataset.kind === 'fails' ? 'radio' : 'checkbox', name: `to-${i}`, value: String(n), checked: chosen.has(n) }),
      ` ${LETTER[rows[n - 1].dataset.kind]}${n}`))));
  });
  const box = clear($('#logic-map'));
  if (steps.length) {
    box.append(logicMap(steps, {
      failLabel: current?.label ?? 'Failure',
      selected: selectedStep,
      onSelect: (id) => {
        selectedStep = id;
        refreshLogic(false);
        rows[Number(id) - 1]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
    }));
  }
}

function collectLogic(problems) {
  const steps = draftSteps();
  if (!steps.length) return undefined;
  const long = steps.flatMap((s) => [s.claim, s.so, s.for]).filter((t) => t && t.split(/\s+/).length > 30);
  if (long.length) problems.push('Logic steps are at most 30 words each.');
  if (!steps.some((s) => 'claim' in s) || !steps.some((s) => 'fails' in s)) problems.push('A logic tree needs at least a claim and the step where it fails.');
  return steps;
}

function collect() {
  const problems = [];
  const doi = normalizeDoi($('#doi').value);
  if (!doi) problems.push('Enter the DOI of the paper.');
  const title = $('#title').value.trim();
  if (title.length < 3) problems.push('Enter the title.');
  const authors = $('#authors').value.split('\n').map((a) => a.trim()).filter(Boolean);
  const year = Number($('#year').value) || undefined;
  const journal = $('#journal').value.trim() || undefined;
  const field = $('#field').value;
  if (!field) problems.push('Choose the field.');
  if (!current) problems.push('Choose what is wrong.');
  const scopeKind = $('#scope').value;
  const scopeRef = $('#scope-ref').value.trim();
  if (scopeKind !== 'whole-paper' && !scopeRef) problems.push('Say which claim, figure, table or dataset.');
  const summary = $('#summary').value.trim();
  if (summary.length < 20 || summary.length > tax.summaryMax) problems.push(`The summary must be 20-${tax.summaryMax} characters.`);
  // With the sealed register, the steward knows who proposed from the login,
  // and the flag file names nobody.
  const pseudonym = tax.sealedRegister ? null : $('#pseudonym').value.trim();
  if (!tax.sealedRegister && !/^[a-z0-9][a-z0-9-]{2,31}$/.test(pseudonym)) problems.push('Enter your pseudonym.');
  const design = $('#design').value || undefined;

  const evidence = [];
  if (current) {
    const alternatives = [];
    current.evidence.forEach((item, i) => {
      const text = $(`#ev-text-${i}`)?.value.trim() ?? '';
      const urls = ($(`#ev-urls-${i}`)?.value ?? '').split('\n').map((u) => u.trim()).filter(Boolean);
      const files = ($(`#ev-files-${i}`)?.value ?? '').split(',').map((f) => f.trim()).filter(Boolean);
      const alt = /^Or\b/.test(item) || /^Or\b/.test(current.evidence[i + 1] ?? '');
      if (alt) alternatives.push(Boolean(text));
      if (!text) {
        if (!alt) problems.push(`Evidence item ${i + 1} needs an answer.`);
        return;
      }
      for (const u of urls) if (!/^https?:\/\/\S+$/.test(u)) problems.push(`"${u}" is not an http(s) link.`);
      for (const f of files) if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(f)) problems.push(`"${f}" is not a plain file name.`);
      const quote = $(`#ev-quote-${i}`)?.value.trim() ?? '';
      const page = $(`#ev-page-${i}`)?.value.trim() ?? '';
      if ((quote || files.some((f) => /\.(png|jpe?g|pdf)$/i.test(f))) && !page) problems.push(`Evidence item ${i + 1}: say where in the paper the excerpt comes from.`);
      evidence.push({ item: i + 1, round: 1, text, ...(urls.length ? { urls } : {}), ...(files.length ? { files } : {}), ...(quote ? { quote } : {}), ...(page ? { page } : {}) });
    });
    if (alternatives.length && !alternatives.some(Boolean)) problems.push('Answer at least one of the alternative evidence items.');
    const quoted = evidence.reduce((n, e) => n + ((e.quote ?? '').match(/\S+/g) ?? []).length, 0);
    if (quoted > 300) problems.push(`The quotes add up to ${quoted} words; quote at most 300 words of the paper.`);
  }

  const flag = {
    doi: doi ?? '',
    category: category?.id,
    type: current?.id,
    taxonomy_version: tax.version,
    field,
    design,
    title,
    authors,
    year,
    journal,
    scope: scopeKind === 'whole-paper' ? { kind: scopeKind } : { kind: scopeKind, ref: scopeRef },
    summary,
    evidence,
    logic: collectLogic(problems),
    proposer: pseudonym ?? undefined,
    status: 'proposed',
    request: pseudonym ? { trigger: 'proposal', by: pseudonym } : { trigger: 'proposal' },
    rounds: [],
  };
  return { flag, problems };
}

function update() {
  const count = $('#summary').value.trim().length;
  $('#summary-count').textContent = `${count} of at most ${tax.summaryMax} characters`;
  const ref = $('#scope').value;
  $('#scope-ref-box').hidden = ref === 'whole-paper';
  $('#scope-ref-label').textContent = { claim: 'Quote the claim', figure: 'Which figure (e.g. Figure 3B)', table: 'Which table', dataset: 'Which dataset' }[ref] ?? '';

  const { flag, problems } = collect();
  const box = clear($('#problems'));
  if (problems.length) {
    box.appendChild(h('ul', { class: 'notice' }, problems.map((p) => h('li', null, p))));
    $('#output').hidden = true;
    return;
  }
  const slug = doiSlug(flag.doi);
  const path = `flags/${slug}/${flag.category}.${flag.type}.yaml`;
  const yaml = toYaml(flag) + '\n';
  $('#out-path').textContent = path;
  $('#out-evidence').textContent = `flags/${slug}/evidence/${flag.category}.${flag.type}/`;
  $('#out-yaml').textContent = yaml;
  const forge = $('#open-forge');
  if (tax.newFileUrl) {
    const url = new URL(tax.newFileUrl);
    url.searchParams.set('filename', path);
    url.searchParams.set('value', yaml);
    forge.href = url.href;
    forge.hidden = false;
  } else {
    forge.hidden = true;
  }
  $('#output').hidden = false;
  $('#output').dataset.yaml = yaml;
  $('#output').dataset.path = path;
}

async function init() {
  tax = await loadTaxonomy();
  $('#pseudonym-box').hidden = Boolean(tax.sealedRegister);
  const field = $('#field');
  field.appendChild(h('option', { value: '' }, 'Choose a field'));
  for (const d of tax.domains) {
    field.appendChild(h('optgroup', { label: d.label }, d.fields.map((f) => h('option', { value: f }, f))));
  }
  renderCategories();
  renderEvidence();
  $('#lookup').addEventListener('click', lookup);
  $('#builder').addEventListener('input', update);
  $('#builder').addEventListener('change', update);
  for (const b of document.querySelectorAll('[data-step]')) b.addEventListener('click', () => addStep(b.dataset.step));
  $('#copy-yaml').addEventListener('click', () => navigator.clipboard.writeText($('#output').dataset.yaml));
  $('#download-yaml').addEventListener('click', () => download($('#output').dataset.path.split('/').pop(), $('#output').dataset.yaml, 'text/yaml'));
  update();
}

init();

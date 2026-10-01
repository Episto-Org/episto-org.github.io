// The reference checker. Everything runs in the browser.

import { parseReferences } from '../lib/refparse.js';
import { createIndex, matchReference } from '../lib/match.js';
import { toCsv } from '../lib/csv.js';
import { h, $, clear, severityChip, severityLabel, download, status } from './dom.js';
import { loadIndex, loadTaxonomy, taxonomyLookup, parseFlagKey } from './data.js';

const RANK = { critical: 3, major: 2, caution: 1, propagated: 0 };
const CONFIDENCE = {
  doi: 'DOI match',
  title: 'Title match: verify',
  fuzzy: 'Possible match: check',
};
const MAX_FILE = 5 * 1024 * 1024;

const EXAMPLE = `1. Wakefield AJ, Murch SH, Anthony A, et al. Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. Lancet. 1998;351(9103):637-641. doi:10.1016/S0140-6736(97)11096-0
2. Open Science Collaboration. Estimating the reproducibility of psychological science. Science. 2015;349(6251):aac4716. doi:10.1126/science.aac4716
3. Stapel DA, Lindenberg S. Coping with chaos: how disordered contexts promote stereotyping and discrimination. Science. 2011;332(6026):251-253.
4. Ioannidis JPA. Why most published research findings are false. PLoS Med. 2005;2(8):e124. doi:10.1371/journal.pmed.0020124`;

let state = null; // {rows, index, lookup}
let lastResults = [];

async function ready() {
  if (state) return state;
  status($('#status'), 'Loading the flag list (a few megabytes, once)…');
  const [data, taxonomy] = await Promise.all([loadIndex(), loadTaxonomy()]);
  const papers = data.papers.map((r) => ({ id: r.i, doi: r.d, title: r.t, year: r.y, row: r }));
  state = { data, index: createIndex(papers), lookup: taxonomyLookup(taxonomy) };
  clear($('#status'));
  return state;
}

function flagsOf(row, lookup) {
  return row.k.map((k) => {
    const { key, severity } = parseFlagKey(k);
    return { key, severity, label: lookup.types.get(key)?.label ?? key };
  });
}

async function run(event) {
  event?.preventDefault();
  const text = $('#refs').value;
  const refs = parseReferences(text);
  if (refs.length === 0) {
    $('#report').hidden = true;
    status($('#status'), 'No references found. Paste one reference per line, or BibTeX or RIS.', 'error');
    return;
  }
  let s;
  try {
    s = await ready();
  } catch (e) {
    status($('#status'), `The flag list could not be loaded: ${e.message}`, 'error');
    return;
  }
  const citingYear = Number($('#year').value) || null;
  lastResults = refs.map((ref, n) => {
    const m = matchReference(s.index, ref);
    const row = m?.paper.row ?? null;
    return {
      n: n + 1,
      ref,
      confidence: m?.confidence ?? null,
      row,
      severity: row?.s ?? null,
      flags: row ? flagsOf(row, s.lookup) : [],
      after: row && citingYear && row.fd && citingYear > Number(row.fd.slice(0, 4)) ? row.fd : null,
    };
  });
  render();
}

function paperUrl(row) {
  return `paper.html?id=${encodeURIComponent(row.i)}`;
}

function render() {
  const results = lastResults;
  const onlyFlagged = $('#only-flagged').checked;
  const counts = { critical: 0, major: 0, caution: 0, propagated: 0 };
  for (const r of results) if (r.severity) counts[r.severity]++;
  const flagged = results.filter((r) => r.severity);
  const noDoi = results.filter((r) => !r.ref.doi).length;

  clear($('#summary')).append(
    h(
      'span',
      { class: 'summary' },
      h('span', null, `${results.length} reference${results.length === 1 ? '' : 's'}`),
      ['critical', 'major', 'caution', 'propagated']
        .filter((sev) => counts[sev])
        .map((sev) => h('span', { class: 'row' }, severityChip(sev), ` ${counts[sev]}`)),
      flagged.length === 0 ? h('span', { class: 'chip chip-clear' }, 'None flagged') : null,
    ),
  );
  $('#hint').textContent = noDoi
    ? `${noDoi} reference${noDoi === 1 ? ' has' : 's have'} no DOI and ${noDoi === 1 ? 'was' : 'were'} matched by title. Add DOIs for certain matches.`
    : '';

  const list = clear($('#results'));
  const shown = (onlyFlagged ? flagged : results)
    .slice()
    .sort((a, b) => (RANK[b.severity] ?? -1) - (RANK[a.severity] ?? -1) || a.n - b.n);
  for (const r of shown) list.appendChild(resultItem(r));
  if (shown.length === 0) list.appendChild(h('li', null, 'None of these references are flagged.'));
  $('#report').hidden = false;
}

function resultItem(r) {
  const li = h('li', { class: r.severity ? `sev-${r.severity}` : '' });
  const head = h('div', { class: 'result-head' }, r.severity ? severityChip(r.severity) : h('span', { class: 'chip chip-clear' }, 'Not flagged'));
  if (r.row) {
    head.append(
      h('a', { href: paperUrl(r.row) }, r.row.t || r.row.d || 'Flagged paper'),
      h('span', { class: `badge${r.confidence === 'doi' ? '' : ' verify'}` }, CONFIDENCE[r.confidence]),
    );
  }
  const raw = r.ref.raw.length > 400 ? r.ref.raw.slice(0, 400) + '…' : r.ref.raw;
  li.append(head, h('p', { class: 'ref' }, /^\s*(\[?\d+[\].)]|\d+\s)/.test(raw) ? raw : `${r.n}. ${raw}`));
  if (r.flags.length) {
    li.append(h('p', { class: 'note' }, r.flags.map((f) => h('span', { class: 'tag' }, `${severityLabel(f.severity)}: ${f.label}`))));
  } else if (r.severity === 'propagated') {
    li.append(h('p', { class: 'note' }, `Cites ${r.row.p} paper${r.row.p === 1 ? '' : 's'} flagged Critical or Major.`));
  }
  if (r.after) li.append(h('p', { class: 'note warn' }, `Cited after it was flagged (${r.after}).`));
  return li;
}

function absolute(url) {
  return new URL(url, location.href).href;
}

function reportText() {
  const lines = [`Episto reference check, ${new Date().toISOString().slice(0, 10)}`, ''];
  for (const r of lastResults.filter((x) => x.severity)) {
    lines.push(`[${severityLabel(r.severity).toUpperCase()}] Reference ${r.n}: ${r.ref.raw}`);
    if (r.flags.length) lines.push(`  Flags: ${r.flags.map((f) => `${f.label} (${severityLabel(f.severity)})`).join('; ')}`);
    lines.push(`  Match: ${CONFIDENCE[r.confidence]}. Details: ${absolute(paperUrl(r.row))}`);
    if (r.after) lines.push(`  Cited after it was flagged (${r.after}).`);
    lines.push('');
  }
  if (lines.length === 2) lines.push('None of the references are flagged.');
  lines.push('Flags describe specific problems with specific work, not judgements of authors.');
  return lines.join('\n');
}

function reportCsv() {
  const rows = [['reference_number', 'reference', 'match', 'severity', 'flags', 'paper_id', 'doi', 'title', 'details']];
  for (const r of lastResults) {
    rows.push([
      r.n, r.ref.raw, r.confidence ?? 'none', r.severity ?? '',
      r.flags.map((f) => `${f.label} (${f.severity})`).join('; '),
      r.row?.i ?? '', r.row?.d ?? '', r.row?.t ?? '', r.row ? absolute(paperUrl(r.row)) : '',
    ]);
  }
  return toCsv(rows);
}

async function copyReport() {
  try {
    await navigator.clipboard.writeText(reportText());
    status($('#status'), 'Report copied.', 'ok');
  } catch {
    download('episto-report.txt', reportText(), 'text/plain');
  }
}

function readFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE) {
    status($('#status'), 'That file is larger than 5 MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    $('#refs').value = String(reader.result);
    run();
  };
  reader.readAsText(file);
}

function init() {
  $('#check-form').addEventListener('submit', run);
  $('#example').addEventListener('click', () => {
    $('#refs').value = EXAMPLE;
    $('#year').value = '2024';
    run();
  });
  $('#only-flagged').addEventListener('change', render);
  $('#copy').addEventListener('click', copyReport);
  $('#csv').addEventListener('click', () => download('episto-report.csv', reportCsv()));
  $('#print').addEventListener('click', () => window.print());
  $('#file').addEventListener('change', (e) => readFile(e.target.files[0]));
  const zone = $('#dropzone');
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    readFile(e.dataTransfer.files[0]);
  });
}

init();

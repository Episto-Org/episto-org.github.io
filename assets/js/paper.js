// One paper and its flags.

import { logicMap } from './logicmap.js';
import { h, $, clear, severityChip, severityLabel, getParams, status } from './dom.js';
import { loadPaper, loadTaxonomy, taxonomyLookup, loadIndex } from './data.js';

const IF_YOU_CITE = {
  critical: 'Do not rely on this work for the flagged finding.',
  major: 'Do not rely on the flagged conclusion as stated; check which parts still hold.',
  caution: 'Rely on the flagged result only with the stated limitation in mind.',
};
const SCOPE = { 'whole-paper': 'Whole paper', claim: 'Claim', figure: 'Figure', table: 'Table', dataset: 'Dataset' };
const TRIGGER = {
  proposal: 'Proposal',
  dispute: 'Dispute',
  reproposal: 'Re-proposal',
  'author-response': "Authors' response",
  'outside-event': 'Outside event',
  'capture-review': 'Capture review',
};

function copyButton(label, text) {
  const b = h('button', { type: 'button' }, label);
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = label), 1500);
    } catch {
      window.prompt('Copy this:', text);
    }
  });
  return b;
}

function citation(p) {
  const authors = p.authors.length > 6 ? `${p.authors.slice(0, 6).join(', ')}, et al.` : p.authors.join(', ');
  return [authors, p.year ? `(${p.year}).` : null, p.title ? `${p.title}.` : null, p.journal ? `${p.journal}.` : null, p.doi ? `https://doi.org/${p.doi}` : null]
    .filter(Boolean)
    .join(' ');
}

function decisionLine(f) {
  if (f.source === 'community') {
    const verb = f.status === 'withdrawn' ? 'Withdrawn after dispute' : 'Verified';
    return `${verb}: ${f.votesHolds} of ${f.panel} reviewers found the flag holds · round ${f.round} · ${f.decided}`;
  }
  return `Official notice, recorded by Retraction Watch${f.decided ? ` · ${f.decided}` : ''}`;
}

function flagCard(f, lookup) {
  const type = lookup.types.get(f.key);
  const withdrawn = f.status === 'withdrawn';
  const card = h('article', { class: `card sev-${f.severity}${withdrawn ? ' withdrawn' : ''}` });
  card.append(
    h('div', { class: 'result-head' }, severityChip(f.severity), withdrawn ? h('span', { class: 'badge' }, 'Withdrawn') : null,
      h('span', { class: 'badge' }, f.source === 'community' ? 'Community flag' : 'Official notice')),
    h('h3', null, `${type?.category.label ?? f.category} › `, h('a', { href: `guide.html#${f.key}`, title: type?.description }, type?.label ?? f.key)),
    h('p', null, f.summary),
  );
  const dl = h('dl');
  const row = (term, ...value) => dl.append(h('dt', null, term), h('dd', null, ...value));
  row('Scope', SCOPE[f.scope] ?? f.scope, f.scopeRef ? `: ${f.scopeRef}` : '');
  if (f.logic?.length) row('Why it lands here', logicMap(f.logic, { failLabel: type?.label ?? f.key }));
  const links = [...f.evidence.map((u) => [u, u]), ...(f.files ?? []).map((u) => [u, u.split('/').pop()])];
  if (links.length) {
    row('How we know', h('ul', null, links.map(([href, label]) => h('li', null, h('a', { href, rel: 'noopener noreferrer nofollow' }, label)))));
  }
  if (!withdrawn && IF_YOU_CITE[f.severity]) row('If you cite this', IF_YOU_CITE[f.severity]);
  row('Decision', decisionLine(f));
  if (f.reasoning?.length) row('Reviewers said', h('ul', null, f.reasoning.map((r) => h('li', null, r))));
  if (f.authorResponse) row("Authors' response", h('a', { href: f.authorResponse, rel: 'noopener noreferrer nofollow' }, 'Read the response'));
  card.append(dl);
  if (f.history?.length > 1 || (f.history?.length === 1 && f.source === 'community')) {
    card.append(
      h('details', null, h('summary', null, 'History'), h('ol', { class: 'timeline' }, f.history.map((r) =>
        h('li', null, `${r.decided} · ${TRIGGER[r.trigger] ?? r.trigger} · panel of ${r.panel} · ${r.votesHolds} found it holds · ${r.statusAfter}`),
      ))),
    );
  }
  return card;
}

async function relatedList(ids) {
  const index = await loadIndex();
  const byId = new Map(index.papers.map((r) => [r.i, r]));
  return h('ul', null, ids.map((x) => {
    const id = typeof x === 'string' ? x : x.id;
    const r = byId.get(id);
    const title = r?.t ?? (typeof x === 'object' ? x.title : null) ?? id;
    return h('li', null, r?.s ? severityChip(r.s) : null, ' ', h('a', { href: `paper.html?id=${encodeURIComponent(id)}` }, title));
  }));
}

async function init() {
  const root = $('#paper');
  const id = getParams().get('id');
  if (!id) return status(root, 'No paper selected. Search for one on the Browse page.', 'error');
  let paper, taxonomy;
  try {
    [paper, taxonomy] = await Promise.all([loadPaper(id), loadTaxonomy()]);
  } catch (e) {
    return status(root, `This page could not be loaded: ${e.message}`, 'error');
  }
  if (!paper) return status(root, 'This paper is not in the list. It has no retractions or verified flags.', 'info');
  const lookup = taxonomyLookup(taxonomy);
  document.title = `${paper.title ?? paper.doi} · Episto`;
  clear(root);

  const meta = [paper.authors.slice(0, 8).join(', ') + (paper.authors.length > 8 ? ', et al.' : ''), paper.journal, paper.year].filter(Boolean).join(' · ');
  root.append(
    h('h1', null, paper.title ?? paper.doi),
    h('p', { class: 'meta' }, meta, paper.doi ? [' · ', h('a', { href: `https://doi.org/${paper.doi}`, rel: 'noopener noreferrer' }, `doi:${paper.doi}`)] : null),
    h('div', { class: 'row no-print' },
      paper.doi ? copyButton('Copy DOI', paper.doi) : null,
      copyButton('Copy citation', citation(paper)),
      copyButton('Copy link', location.href),
      taxonomy.contact ? h('a', { class: 'button', href: `mailto:${taxonomy.contact}?subject=${encodeURIComponent(`Episto: ${paper.id}`)}` }, 'Report a problem') : null,
    ),
  );

  const active = paper.flags.filter((f) => f.status !== 'withdrawn');
  const withdrawn = paper.flags.filter((f) => f.status === 'withdrawn');
  if (paper.severity) root.append(h('p', null, 'Overall: ', severityChip(paper.severity)));
  if (active.length) {
    root.append(h('h2', null, `${active.length} flag${active.length === 1 ? '' : 's'}`));
    for (const f of active) root.append(flagCard(f, lookup));
  }
  if (paper.propagated.length) {
    root.append(
      h('h2', null, 'Builds on flagged work'),
      h('p', null, `This paper cites ${paper.propagated.length} paper${paper.propagated.length === 1 ? '' : 's'} flagged ${severityLabel('critical')} or ${severityLabel('major')}:`),
      await relatedList(paper.propagated),
    );
  }
  if (withdrawn.length) {
    root.append(h('h2', null, 'Withdrawn flags'), h('p', { class: 'hint' }, 'These flags were verified once and later withdrawn after a dispute.'));
    for (const f of withdrawn) root.append(flagCard(f, lookup));
  }
  if (paper.citedBy.length) {
    root.append(
      h('h2', null, 'Papers citing this'),
      h('p', { class: 'hint' }, 'From reference lists contributed to Episto; not a complete citation list.'),
      await relatedList(paper.citedBy),
    );
  }
  root.append(h('p', { class: 'hint' }, 'A flag describes a specific problem with specific work, not a judgement of the authors. Authors can respond; see About.'));
}

init();

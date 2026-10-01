// Matches parsed references against flagged papers.
//
// Confidence levels:
//   doi    - the DOI is in the list. Certain.
//   title  - the normalised title matches exactly, or appears whole inside
//            the reference. Very likely; the reader should verify.
//   fuzzy  - most words of the title match. Possible; the reader should check.

import { normalizeTitle, tokens, dice, coverage } from './text.js';

const MIN_TITLE_TOKENS = 4;
const FUZZY_DICE = 0.85;
const FUZZY_COVERAGE = 0.9;
const MAX_CANDIDATES = 3000;

/** @param papers {{id: string, doi?: string|null, title?: string|null, year?: number|null}[]} */
export function createIndex(papers) {
  const byDoi = new Map();
  const byTitle = new Map();
  const postings = new Map();
  const titleTokens = [];
  papers.forEach((p, i) => {
    if (p.doi) byDoi.set(p.doi, i);
    const norm = normalizeTitle(p.title ?? '');
    const toks = tokens(norm);
    titleTokens[i] = { norm, toks };
    if (toks.size >= MIN_TITLE_TOKENS) {
      if (!byTitle.has(norm)) byTitle.set(norm, []);
      byTitle.get(norm).push(i);
      for (const t of toks) {
        let list = postings.get(t);
        if (!list) postings.set(t, (list = []));
        list.push(i);
      }
    }
  });
  return { papers, byDoi, byTitle, postings, titleTokens };
}

/**
 * @returns {{paper: object, confidence: 'doi'|'title'|'fuzzy'} | null}
 */
export function matchReference(index, ref, { fuzzy = true } = {}) {
  if (ref.doi && index.byDoi.has(ref.doi)) {
    return { paper: index.papers[index.byDoi.get(ref.doi)], confidence: 'doi' };
  }

  const refTitle = normalizeTitle(ref.title ?? '');
  const refTitleToks = tokens(refTitle);
  if (refTitleToks.size >= MIN_TITLE_TOKENS && index.byTitle.has(refTitle)) {
    const hit = pickByYear(index, index.byTitle.get(refTitle), ref.year);
    return { paper: index.papers[hit], confidence: 'title' };
  }

  // A reference with a DOI that is not in the list is taken to be a
  // different paper; only exact matches above apply to it.
  if (ref.doi) return null;

  const rawNorm = normalizeTitle(ref.raw ?? '');
  const rawToks = tokens(rawNorm);
  const candidates = candidateIds(index, new Set([...refTitleToks, ...rawToks]));
  let best = null;
  for (const i of candidates) {
    const { norm, toks } = index.titleTokens[i];
    const paper = index.papers[i];
    if (!yearCompatible(paper.year, ref.year)) continue;
    if (norm.length >= 25 && (' ' + rawNorm + ' ').includes(' ' + norm + ' ')) {
      return { paper, confidence: 'title' };
    }
    if (!fuzzy) continue;
    const score = Math.max(
      refTitleToks.size ? dice(refTitleToks, toks) : 0,
      coverage(toks, rawToks) >= FUZZY_COVERAGE && toks.size >= 6 ? FUZZY_DICE : 0,
    );
    if (score >= FUZZY_DICE && (!best || score > best.score)) best = { paper, score };
  }
  return best ? { paper: best.paper, confidence: 'fuzzy' } : null;
}

function candidateIds(index, refToks) {
  const lists = [];
  for (const t of refToks) {
    const list = index.postings.get(t);
    if (list) lists.push(list);
  }
  lists.sort((a, b) => a.length - b.length);
  const out = new Set();
  for (const list of lists.slice(0, 3)) {
    for (const i of list) {
      out.add(i);
      if (out.size >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}

function yearCompatible(a, b) {
  return !a || !b || Math.abs(a - b) <= 1;
}

function pickByYear(index, ids, year) {
  if (!year) return ids[0];
  return ids.find((i) => yearCompatible(index.papers[i].year, year)) ?? ids[0];
}

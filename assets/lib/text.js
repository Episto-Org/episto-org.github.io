// Title normalisation and similarity, shared by the browser and the build.

const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have in into is it its of on or ' +
    'that the their this to was were with within without'
  ).split(' '),
);

/**
 * Lowercase, strip accents and punctuation, collapse spaces. Letters and
 * digits of every script are kept, so non-Latin titles still match.
 */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Distinct content words of a normalised string. A plural "s" is dropped so
 * "adolescent" and "adolescents" count as the same word.
 */
export function tokens(normalized) {
  const out = new Set();
  for (const t of normalized.split(' ')) {
    if (t.length > 1 && !STOPWORDS.has(t)) {
      out.add(t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
    }
  }
  return out;
}

/** Dice coefficient of two token sets, 0..1. */
export function dice(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** Share of `part` tokens that also appear in `whole`, 0..1. */
export function coverage(part, whole) {
  if (part.size === 0) return 0;
  let shared = 0;
  for (const t of part) if (whole.has(t)) shared++;
  return shared / part.size;
}

// Loads the published data files. Each is fetched once per page.

import { shardOf } from '../lib/shard.js';

const cache = new Map();
// Data sits at <site>/data/, two levels up from this module, so pages in
// sub-folders load the same files.
const DATA = new URL('../../data/', import.meta.url);

async function json(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(new URL(path, DATA), { credentials: 'omit' }).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
        return r.json();
      }),
    );
  }
  return cache.get(path);
}

/**
 * The checker's list, expanded to
 * {i: id, d: doi, t: title, y: year, s: severity, k: ["type:severity"], p: propagated, fd: first flagged}.
 * See indexFiles() in tools/lib/dataset.mjs for the compact format.
 */
export async function loadIndex() {
  if (!cache.has('expanded')) {
    cache.set('expanded', json('index.json').then((raw) => ({
      ...raw,
      papers: raw.papers.map(([id, d, t, y, s, flags, p, fd]) => ({
        i: id ?? `doi:${d}`,
        d,
        t,
        y,
        s: s < 0 ? null : raw.severities[s],
        k: flags.map((f) => `${raw.types[f >> 2]}:${raw.severities[f & 3]}`),
        p,
        fd,
      })),
    })));
  }
  return cache.get('expanded');
}

/** The checker's list plus the browse fields a, j, dm, f, src, w, dt. */
export async function loadBrowse() {
  const [index, raw, rawIndex] = await Promise.all([loadIndex(), json('browse.json'), json('index.json')]);
  const sources = [[1, 'retraction-watch'], [2, 'community']];
  index.papers.forEach((r, n) => {
    const [a, j, dm, f, src, w, dt] = raw.rows[n];
    Object.assign(r, {
      a,
      j,
      dm: raw.domains.filter((_, bit) => dm & (1 << bit)),
      f,
      src: sources.filter(([bit]) => src & bit).map(([, name]) => name),
      w: w.map((t) => rawIndex.types[t]),
      dt,
    });
  });
  return index;
}
export const loadTaxonomy = () => json('taxonomy.json');

export async function loadPaper(id) {
  const shard = await json(`papers/${shardOf(id)}.json`);
  return Object.prototype.hasOwnProperty.call(shard, id) ? shard[id] : null;
}

/** Lookup tables for flag keys ("category.type") and categories. */
export function taxonomyLookup(taxonomy) {
  const types = new Map();
  const categories = new Map();
  for (const c of taxonomy.categories) {
    categories.set(c.id, c);
    for (const t of c.types) types.set(`${c.id}.${t.id}`, { ...t, category: c });
  }
  return { types, categories };
}

/** "stats.impossible-values:major" -> {key, severity} */
export function parseFlagKey(k) {
  const i = k.lastIndexOf(':');
  return { key: k.slice(0, i), severity: k.slice(i + 1) };
}

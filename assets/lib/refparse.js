// Turns pasted reference lists into structured references.
// Accepts BibTeX, RIS, or plain text in any common citation style.

import { extractDois, normalizeDoi } from './doi.js';

const MAX_REFERENCES = 5000;

/**
 * @returns {{raw: string, doi: string|null, title: string|null,
 *            year: number|null, authors: string|null, format: string}[]}
 */
export function parseReferences(text) {
  const input = String(text ?? '').replace(/\r\n?/g, '\n');
  let refs;
  if (/@[a-z]+\s*\{/i.test(input)) refs = parseBibtex(input);
  else if (/^TY {2}- /m.test(input)) refs = parseRis(input);
  else refs = parseText(input);
  return refs.slice(0, MAX_REFERENCES);
}

// ---------------------------------------------------------------- BibTeX

function parseBibtex(input) {
  const out = [];
  const entryStart = /@([a-z]+)\s*\{/gi;
  let m;
  while ((m = entryStart.exec(input))) {
    const type = m[1].toLowerCase();
    const bodyStart = entryStart.lastIndex;
    const end = matchBrace(input, bodyStart - 1);
    if (end < 0) break;
    entryStart.lastIndex = end + 1;
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    const body = input.slice(bodyStart, end);
    const fields = bibtexFields(body);
    const raw = input.slice(m.index, end + 1);
    out.push({
      raw,
      doi: normalizeDoi(fields.doi ?? '') ?? extractDois(fields.url ?? '')[0] ?? null,
      title: cleanLatex(fields.title) || null,
      year: toYear(fields.year ?? fields.date),
      authors: cleanLatex(fields.author) || null,
      format: 'bibtex',
    });
  }
  return out;
}

function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function bibtexFields(body) {
  const fields = {};
  const comma = body.indexOf(',');
  let i = comma < 0 ? body.length : comma + 1;
  while (i < body.length) {
    const nameMatch = /^\s*([a-z_-]+)\s*=\s*/i.exec(body.slice(i));
    if (!nameMatch) break;
    const name = nameMatch[1].toLowerCase();
    i += nameMatch[0].length;
    let value = '';
    if (body[i] === '{') {
      const end = matchBrace(body, i);
      if (end < 0) break;
      value = body.slice(i + 1, end);
      i = end + 1;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      if (end < 0) break;
      value = body.slice(i + 1, end);
      i = end + 1;
    } else {
      const end = body.slice(i).search(/[,}]|$/);
      value = body.slice(i, i + end).trim();
      i += end;
    }
    fields[name] = value;
    const next = body.indexOf(',', i);
    if (next < 0) break;
    i = next + 1;
  }
  return fields;
}

function cleanLatex(s) {
  if (!s) return '';
  return s
    .replace(/\\[a-z]+\s*\{([^{}]*)\}/gi, '$1')
    .replace(/\\.|[{}]/g, (x) => (x.length === 2 ? x[1] : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------- RIS

function parseRis(input) {
  const out = [];
  for (const block of input.split(/^ER {2}-.*$/m)) {
    if (!/^TY {2}- /m.test(block)) continue;
    const tag = (names) => {
      for (const n of names) {
        const m = new RegExp(`^${n} {2}- (.+)$`, 'm').exec(block);
        if (m) return m[1].trim();
      }
      return null;
    };
    const authors = [...block.matchAll(/^(?:AU|A1) {2}- (.+)$/gm)].map((m) => m[1].trim());
    out.push({
      raw: block.trim(),
      doi: normalizeDoi(tag(['DO']) ?? '') ?? extractDois(tag(['UR']) ?? '')[0] ?? null,
      title: tag(['TI', 'T1', 'CT']),
      year: toYear(tag(['PY', 'Y1', 'DA'])),
      authors: authors.join('; ') || null,
      format: 'ris',
    });
  }
  return out;
}

// ------------------------------------------------------------ plain text

const NUMBERED = /^\s*(?:\[\d{1,4}\]|\d{1,4}[.)]\s)/;

function parseText(input) {
  const lines = input.split('\n');
  let entries;
  if (/\n\s*\n/.test(input.trim())) {
    entries = input.split(/\n\s*\n/);
  } else {
    const nonEmpty = lines.filter((l) => l.trim());
    const numbered = nonEmpty.filter((l) => NUMBERED.test(l)).length;
    if (numbered >= 2 && numbered >= nonEmpty.length / 3) {
      entries = [];
      for (const l of nonEmpty) {
        if (NUMBERED.test(l) || entries.length === 0) entries.push(l);
        else entries[entries.length - 1] += ' ' + l.trim();
      }
    } else {
      entries = nonEmpty;
    }
  }
  return entries
    .map((e) => e.replace(/\s+/g, ' ').trim())
    .filter((e) => e.length >= 8)
    .map((raw) => ({
      raw,
      doi: extractDois(raw)[0] ?? null,
      title: guessTitle(raw),
      year: toYear(raw),
      authors: null,
      format: 'text',
    }));
}

function wordCount(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

function guessTitle(raw) {
  const text = raw.replace(NUMBERED, '').replace(/https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+/gi, '');

  // Quoted titles: "Title", “Title”, «Title».
  const quoted = /["“«]([^"”»]{10,400})["”»]/.exec(text);
  if (quoted && wordCount(quoted[1]) >= 3) return quoted[1].replace(/[.,]\s*$/, '').trim();

  // APA: Authors (2019). Title. Journal...
  const apa = /\(\s*(?:1[6-9]|20)\d\d[a-z]?(?:,[^)]*)?\)\.?\s+(.+?[.?!])(?:\s|$)/.exec(text);
  if (apa && wordCount(apa[1]) >= 3) return apa[1].replace(/\.$/, '').trim();

  // Other styles: choose the sentence that looks most like a title.
  const segments = text.split(/(?<=[.?!])\s+(?=[A-Z0-9\p{Lu}])/u);
  let best = null;
  let bestScore = 0;
  for (const seg of segments) {
    const s = seg.replace(/[.]$/, '').trim();
    const words = wordCount(s);
    if (words < 4) continue;
    const initials = (s.match(/\b\p{Lu}\.(?:\s|,|$)/gu) || []).length;
    const commas = (s.match(/,/g) || []).length;
    const looksLikeAuthors = initials >= 2 || commas / words > 0.3;
    const looksLikeVenue = /\b\d{1,4}\s*[(:]\s*\d|\bpp?\.\s*\d|\bvol\.?\s*\d/i.test(s);
    if (looksLikeAuthors || looksLikeVenue) continue;
    if (words > bestScore) {
      best = s;
      bestScore = words;
    }
  }
  return best;
}

function toYear(s) {
  if (!s) return null;
  const m = /\b(1[6-9]\d\d|20\d\d)\b/.exec(String(s));
  return m ? Number(m[1]) : null;
}

// DOI handling shared by the browser and the build tools.
//
// DOIs are case-insensitive, so every DOI is stored lowercased. A DOI is
// "10." + a registrant code of 4-9 digits + "/" + any non-space suffix.

const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;
const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"'<>]+/gi;
const DOI_PREFIX = /^(?:https?:\/\/)?(?:dx\.)?doi\.org\/|^doi:\s*/i;

function stripTrailing(s) {
  for (;;) {
    if (/[.,;:\]}>'"]$/.test(s)) {
      s = s.slice(0, -1);
    } else if (s.endsWith(')') && count(s, '(') < count(s, ')')) {
      s = s.slice(0, -1);
    } else {
      return s;
    }
  }
}

function count(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Returns the lowercased DOI, or null when the input is not a DOI. */
export function normalizeDoi(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (s.length === 0 || s.length > 300) return null;
  s = s.replace(DOI_PREFIX, '');
  if (/%[0-9a-f]{2}/i.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      return null;
    }
  }
  s = stripTrailing(s.trim());
  if (!DOI_SHAPE.test(s)) return null;
  return s.toLowerCase();
}

/** Every distinct DOI in a piece of text, in order of first appearance. */
export function extractDois(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text).matchAll(DOI_IN_TEXT)) {
    const doi = normalizeDoi(m[0]);
    if (doi && !seen.has(doi)) {
      seen.add(doi);
      out.push(doi);
    }
  }
  return out;
}

/**
 * A file-system and URL safe name for a DOI. Reversible: letters, digits,
 * "." and "-" are kept, every other byte becomes "_" plus two hex digits.
 */
export function doiSlug(doi) {
  const bytes = new TextEncoder().encode(doi.toLowerCase());
  let out = '';
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (/[a-z0-9.-]/.test(c)) out += c;
    else out += '_' + b.toString(16).padStart(2, '0');
  }
  return out;
}

export function slugToDoi(slug) {
  if (!/^[a-z0-9._-]+$/.test(slug)) return null;
  const bytes = [];
  for (let i = 0; i < slug.length; i++) {
    if (slug[i] === '_') {
      const hex = slug.slice(i + 1, i + 3);
      if (!/^[0-9a-f]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(slug.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

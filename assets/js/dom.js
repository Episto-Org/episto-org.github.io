// DOM helpers. Every piece of data goes into the page as text through these
// helpers, never as HTML, so titles or summaries cannot inject markup.

/**
 * h('a', {href, class}, 'text', child, ...) -> Element
 * Attributes named on* are refused; href and src must be safe links.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (/^on/i.test(k)) throw new Error('event attributes are not allowed');
    if (k === 'href' || k === 'src') {
      const safe = safeUrl(v);
      if (safe === null) continue;
      el.setAttribute(k, safe);
    } else if (k === 'class') {
      el.className = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/**
 * Resolves a link against the page and keeps it only if it is http(s) or
 * mailto. Resolving first matters: browsers strip leading spaces and control
 * characters, so " javascript:..." must not pass as a relative link.
 */
export function safeUrl(value) {
  try {
    const u = new URL(String(value), document.baseURI);
    return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  critical: 'M5.5 1h5L15 5.5v5L10.5 15h-5L1 10.5v-5z',
  major: 'M8 1.5l7 13H1z',
  caution: 'M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z',
  propagated: 'M6.5 9.5l3-3M5 7l-1.5 1.5a2.1 2.1 0 0 0 3 3L8 10M11 9l1.5-1.5a2.1 2.1 0 0 0-3-3L8 6',
};

export function icon(severity) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${severity}`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[severity] ?? ICON_PATHS.caution);
  svg.appendChild(path);
  return svg;
}

const LABELS = { critical: 'Critical', major: 'Major', caution: 'Caution', propagated: 'Builds on flagged work' };

export function severityChip(severity) {
  if (!severity) return h('span', { class: 'chip chip-none' }, 'Not flagged');
  return h('span', { class: `chip chip-${severity}` }, icon(severity), LABELS[severity] ?? severity);
}

export function severityLabel(severity) {
  return LABELS[severity] ?? severity;
}

/** Reads and writes page state in the URL query, so every view has a link. */
export function getParams() {
  return new URLSearchParams(location.search);
}

export function setParams(params) {
  const q = params.toString();
  history.replaceState(null, '', q ? `?${q}` : location.pathname);
}

export function download(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  // A blob: link is made here, from local data, so it bypasses safeUrl.
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function status(el, message, kind = 'info') {
  clear(el).appendChild(h('p', { class: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message));
}

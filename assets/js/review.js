// The sealed-review helper: builds a review, computes its commitment, and
// later produces the reveal. Uses the same code as the steward
// (lib/commitment.js), so the hashes always agree.

import { commitmentOf, randomSalt, validateReview, EVIDENCE_FINDINGS, REVIEW_VERSION } from '../lib/commitment.js';
import { seal as sealTo } from '../lib/seals.js';
import { h, $, clear, download } from './dom.js';
import { loadPoolsConfig } from './pools.js';

/** The steward's public key, when the ticket asks for reviews sealed to it. */
async function stewardKeyFor(t) {
  if (!t.seal) return null;
  const { stewardKey } = await loadPoolsConfig();
  if (!stewardKey) throw new Error('this site has no steward key');
  const der = Uint8Array.from(atob(stewardKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const kid = [...new Uint8Array(await crypto.subtle.digest('SHA-256', der))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
  if (kid !== t.seal) throw new Error('the ticket names a different steward key; reload the page');
  return stewardKey;
}

let ticket = null;
let sealed = null;
const LABELS = { holds: 'Holds', 'does-not-hold': 'Does not hold', 'cannot-check': 'Cannot check', accept: 'Accept', reject: 'Reject' };

/** Flags and calibration cases judge evidence; rule changes and projects are accepted or rejected. */
function judgesEvidence(t) {
  return t.kind === 'flag' || t.kind === 'calibration';
}

function storeKey(t) {
  return `episto-review|${t.case}|${t.round}`;
}

function remember(review) {
  try {
    localStorage.setItem(storeKey(review), JSON.stringify(review));
  } catch {
    // Private browsing or blocked storage: the downloaded file is the backup.
  }
}

function recall(t) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(t)) ?? 'null');
  } catch {
    return null;
  }
}

function readTicket() {
  const status = $('#ticket-status');
  ticket = null;
  $('#review-form').hidden = true;
  const text = $('#ticket').value.trim();
  if (!text) {
    status.textContent = '';
    return;
  }
  try {
    const t = JSON.parse(text);
    if (t.v !== 1 || typeof t.case !== 'string' || !Number.isInteger(t.round) || !['flag', 'rules', 'project', 'calibration'].includes(t.kind)) throw new Error();
    if (judgesEvidence(t) && (!Number.isInteger(t.evidence) || !Array.isArray(t.severities))) throw new Error();
    ticket = t;
  } catch {
    status.textContent = 'That is not a ticket. Copy the whole JSON block from the steward comment.';
    return;
  }
  status.textContent = `Case ${ticket.case}, round ${ticket.round}.`;
  renderForm();
  $('#reveal-box').hidden = Boolean(ticket.seal);
  const saved = ticket.seal ? null : recall(ticket);
  if (saved) showReveal(saved);
}

function radios(name, values, onChange) {
  return values.map((v) => {
    const input = h('input', { type: 'radio', name, value: v });
    if (onChange) input.addEventListener('change', onChange);
    return h('label', { class: 'check' }, input, LABELS[v]);
  });
}

function renderForm() {
  const ev = clear($('#evidence-findings'));
  if (judgesEvidence(ticket)) {
    ev.append(h('p', null, h('strong', null, 'Each evidence entry, in the order of the flag file')));
    for (let i = 0; i < ticket.evidence; i++) {
      ev.append(h('fieldset', null, h('legend', null, `Evidence ${i + 1}`), h('div', { class: 'row' }, radios(`ev-${i}`, EVIDENCE_FINDINGS))));
    }
  }
  const verdicts = clear($('#verdicts'));
  verdicts.append(...radios('verdict', judgesEvidence(ticket) ? ['holds', 'does-not-hold'] : ['accept', 'reject'], () => {
    $('#severity-box').hidden = !(judgesEvidence(ticket) && checked('verdict') === 'holds');
  }));
  const sev = clear($('#severity'));
  for (const s of ticket.severities ?? []) sev.append(h('option', { value: s }, s[0].toUpperCase() + s.slice(1)));
  $('#review-form').hidden = false;
}

function checked(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

async function seal(e) {
  e.preventDefault();
  const verdict = checked('verdict');
  const review = {
    v: REVIEW_VERSION,
    case: ticket.case,
    round: ticket.round,
    verdict,
    summary: $('#summary').value.trim(),
    reasoning: $('#reasoning').value.trim(),
    salt: randomSalt(),
  };
  if (judgesEvidence(ticket)) {
    review.evidence = Array.from({ length: ticket.evidence }, (_, i) => checked(`ev-${i}`));
    if (verdict === 'holds') review.severity = $('#severity').value;
  }
  const problems = validateReview(review, ticket);
  const box = clear($('#form-problems'));
  if (problems.length) {
    box.append(h('span', { class: 'notice notice-error' }, problems.join('; ')));
    return;
  }
  sealed = review;
  let stewardKey;
  try {
    stewardKey = await stewardKeyFor(ticket);
  } catch (err) {
    box.append(h('span', { class: 'notice notice-error' }, `Cannot seal: ${err.message}.`));
    return;
  }
  const commit = `/commit ${await commitmentOf(review)}`;
  if (stewardKey) {
    // One step: the commitment and the review sealed to the steward.
    $('#commit-line').textContent = `${commit}\n\`\`\`sealed\n${JSON.stringify(await sealTo(review, stewardKey))}\n\`\`\``;
    $('#keep-note').hidden = true;
    $('#save-review').hidden = true;
    $('#sealed-note').hidden = false;
    $('#reveal-box').hidden = true;
  } else {
    remember(review);
    $('#commit-line').textContent = commit;
    showReveal(review);
  }
  $('#sealed').hidden = false;
  for (const el of $('#review-form').elements) el.disabled = true;
  $('#sealed').scrollIntoView({ block: 'start' });
}

async function showReveal(review) {
  sealed = review;
  $('#reveal-text').textContent = `/reveal\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``;
  $('#reveal-text').hidden = false;
  $('#copy-reveal').hidden = false;
  $('#reveal-status').textContent = `Loaded. Its seal is /commit ${await commitmentOf(review)}; it must match the one you posted.`;
}

function loadFile(file) {
  if (!file || file.size > 50_000) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      showReveal(JSON.parse(String(reader.result)));
    } catch {
      $('#reveal-status').textContent = 'That file is not a saved review.';
    }
  };
  reader.readAsText(file);
}

$('#ticket').addEventListener('input', readTicket);
$('#review-form').addEventListener('submit', seal);
$('#copy-commit').addEventListener('click', () => navigator.clipboard.writeText($('#commit-line').textContent));
$('#save-review').addEventListener('click', () => download(`episto-review-round-${sealed.round}.json`, JSON.stringify(sealed, null, 2), 'application/json'));
$('#copy-reveal').addEventListener('click', () => navigator.clipboard.writeText($('#reveal-text').textContent));
$('#load-review').addEventListener('change', (e) => loadFile(e.target.files[0]));

// Sealed reviews: canonical JSON, commitments and review validation.
// Shared by the review helper page and the steward, so both compute the
// same hash for the same review.

export const REVIEW_VERSION = 1;
export const FLAG_VERDICTS = ['holds', 'does-not-hold'];
export const RULES_VERDICTS = ['accept', 'reject'];
export const EVIDENCE_FINDINGS = ['holds', 'does-not-hold', 'cannot-check'];
const SUMMARY_MAX = 280;
const REASONING_MAX = 5000;

/** JSON with sorted keys and no whitespace. Rejects non-JSON values. */
export function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('non-finite number');
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
      return (
        '{' +
        Object.keys(value)
          .sort()
          .filter((k) => value[k] !== undefined)
          .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]))
          .join(',') +
        '}'
      );
    default:
      throw new Error(`cannot encode ${typeof value}`);
  }
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  return hex(await globalThis.crypto.subtle.digest('SHA-256', data));
}

/** The commitment a reviewer posts before reveal: sha256 of the canonical review. */
export async function commitmentOf(review) {
  return sha256Hex(canonicalJson(review));
}

export function randomSalt() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return hex(bytes);
}

/**
 * What a reviewer needs to know about a case, published by the steward when
 * the panel is drawn.
 * @typedef {{v: number, case: string, round: number, kind: 'flag'|'rules',
 *            evidence: number, severities: string[]}} ReviewTicket
 */

/** Checks a review against its ticket. Returns a list of problems. */
export function validateReview(review, ticket) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (typeof review !== 'object' || review === null || Array.isArray(review)) {
    return ['review must be a JSON object'];
  }
  const allowed = new Set(['v', 'case', 'round', 'verdict', 'severity', 'evidence', 'summary', 'reasoning', 'salt']);
  for (const k of Object.keys(review)) if (!allowed.has(k)) err(`unknown field "${k}"`);
  if (review.v !== REVIEW_VERSION) err(`"v" must be ${REVIEW_VERSION}`);
  if (review.case !== ticket.case) err('review is for a different case');
  if (review.round !== ticket.round) err('review is for a different round');
  if (typeof review.salt !== 'string' || !/^[0-9a-f]{64}$/.test(review.salt)) {
    err('"salt" must be 64 hex characters');
  }
  if (typeof review.summary !== 'string' || review.summary.trim().length < 10 || review.summary.length > SUMMARY_MAX) {
    err(`"summary" must be 10-${SUMMARY_MAX} characters`);
  }
  if (typeof review.reasoning !== 'string' || review.reasoning.length > REASONING_MAX) {
    err(`"reasoning" must be text of at most ${REASONING_MAX} characters`);
  }

  if (ticket.kind === 'rules' || ticket.kind === 'project') {
    if (!RULES_VERDICTS.includes(review.verdict)) err(`"verdict" must be one of ${RULES_VERDICTS.join(', ')}`);
    if (review.severity !== undefined) err('"severity" does not apply to rule changes');
    if (review.evidence !== undefined) err('"evidence" does not apply to rule changes');
    return errors;
  }

  if (!FLAG_VERDICTS.includes(review.verdict)) err(`"verdict" must be one of ${FLAG_VERDICTS.join(', ')}`);
  if (review.verdict === 'holds') {
    if (!ticket.severities.includes(review.severity)) {
      err(`"severity" must be one of ${ticket.severities.join(', ')}`);
    }
  } else if (review.severity !== undefined) {
    err('"severity" is only given when the verdict is "holds"');
  }
  if (!Array.isArray(review.evidence) || review.evidence.length !== ticket.evidence) {
    err(`"evidence" must list a finding for each of the ${ticket.evidence} evidence entries`);
  } else {
    review.evidence.forEach((f, i) => {
      if (!EVIDENCE_FINDINGS.includes(f)) err(`evidence ${i + 1}: finding must be one of ${EVIDENCE_FINDINGS.join(', ')}`);
    });
    // A "does not hold" must say which evidence fails.
    if (review.verdict === 'does-not-hold' && review.evidence.every((f) => f === 'holds')) {
      err('a verdict of "does-not-hold" needs at least one evidence entry that does not hold or cannot be checked');
    }
  }
  return errors;
}

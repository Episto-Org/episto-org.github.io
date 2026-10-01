// The account page's sealed requests: unlock with the Episto password,
// invite someone, and the other requests that tools/register.mjs makes.

import { h, $, clear, status } from './dom.js';
import { parseEntry } from './pools.js';
import { deriveKey, sealedRequest, digestOf } from '../lib/seals.js';
import { readBundle } from './bundle.js';

let cfg;
let me = null; // { pseudonym, key }

function fileBlock(path, text, note) {
  const pre = h('pre', null, text);
  const copy = h('button', { type: 'button' }, 'Copy');
  copy.addEventListener('click', () => navigator.clipboard.writeText(text));
  return h('div', { class: 'stack' }, h('p', null, h('strong', null, path), note ? ` ${note}` : ''), pre, h('div', { class: 'row' }, copy));
}

function howTo(newFiles, editsMembers) {
  return h('ol', { class: 'stack' },
    h('li', null, 'On GitHub, open your fork of the members\' repository.'),
    editsMembers ? h('li', null, 'Open members.yaml, choose Edit, replace everything with the members list above, and commit.') : null,
    ...newFiles.map((p) => h('li', null, 'Choose Add file → Create new file, name it ', h('code', null, p), ', paste its text and commit.')),
    h('li', null, 'Open a pull request. The steward checks it and replies within the hour.'));
}

async function unlock() {
  const pseudonym = $('#me').value.trim();
  const password = $('#my-password').value;
  const out = $('#unlock-status');
  if (!pseudonym || !password) return status(out, 'Give your pseudonym and password.', 'error');
  status(out, 'Unlocking. This takes a few seconds.');
  const key = await deriveKey(pseudonym, password);
  me = { pseudonym, key };
  let note = `Unlocked as ${pseudonym}.`;
  try {
    const entry = $('#current').value.trim() ? parseEntry($('#current').value) : null;
    if (entry && entry.pseudonym === pseudonym && entry.key?.split(/\s+/).slice(0, 2).join(' ') !== key.publicLine) {
      me = null;
      return status(out, 'That password does not match the key in your entry. Check it and try again.', 'error');
    }
    if (entry && entry.pseudonym === pseudonym) note += ' The password matches your entry.';
  } catch {
    // no entry pasted: nothing to compare with
  }
  status(out, `${note} Requests are checked by the steward against the members list.`, 'ok');
  $('#invite').hidden = !cfg.sealedRegister;
  $('#requests').hidden = !cfg.sealedRegister;
}

function addEntry(membersText, entryText) {
  const text = membersText.replace(/\r/g, '');
  if (/^members:\s*\[\]\s*$/m.test(text)) return text.replace(/^members:\s*\[\]\s*$/m, `members:\n${entryText.trimEnd()}`) .replace(/\n*$/, '\n');
  return text.replace(/\n*$/, '\n') + entryText;
}

async function prepareInvite() {
  const out = clear($('#invite-out'));
  const st = $('#invite-status');
  let bundle;
  let entry;
  try {
    bundle = readBundle($('#reply').value);
    entry = parseEntry(bundle.entryText);
  } catch (e) {
    return status(st, `That reply cannot be read: ${e.message}.`, 'error');
  }
  if (entry.invited_by !== me.pseudonym) return status(st, `The reply names ${entry.invited_by} as inviter, not you.`, 'error');
  if (!$('#members-now').value.includes('members:')) return status(st, 'Paste the whole members list as it is now.', 'error');
  const members = addEntry($('#members-now').value, bundle.entryText);
  status(st, 'Sealing.');
  const authorize = await sealedRequest(me.key, me.pseudonym, { op: 'authorize', digest: await digestOf(members) }, cfg.stewardKey);
  const files = [bundle.request, authorize].filter(Boolean);
  out.append(
    fileBlock('members.yaml', members, '(the whole new file)'),
    ...files.map((f) => fileBlock(f.path, f.text, f === authorize ? '(your authorization)' : `(${entry.pseudonym}'s login, sealed)`)),
    howTo(files.map((f) => f.path), true));
  status(st, `Ready. Invite ${entry.pseudonym} with one pull request holding these ${files.length + 1} files.`, 'ok');
}

const OPS = {
  authorize: { label: null, members: true },
  login: { label: 'GitHub username', members: false },
  unlogin: { label: 'GitHub username', members: false },
  volunteer: { label: 'Project id', members: false },
  'invite-request': { label: 'Pool', members: false },
  away: { label: 'Back on (YYYY-MM-DD, within 6 months)', members: false },
  back: { label: null, members: false },
  stand: { label: null, members: false },
  contact: { label: 'The ticket from the case (paste it)', members: false },
};

function showOp() {
  const op = OPS[$('#op').value];
  $('#op-value-box').hidden = !op.label;
  $('#op-value-label').textContent = op.label ?? '';
  $('#op-members-box').hidden = !op.members;
  $('#op-scope-box').hidden = $('#op').value !== 'login';
  $('#op-about-box').hidden = $('#op').value !== 'contact';
}

async function sealOne() {
  const op = $('#op').value;
  const value = $('#op-value').value.trim();
  const st = $('#request-status');
  const out = clear($('#request-out'));
  let payload;
  if (op === 'authorize') {
    const text = $('#op-members').value.replace(/\r/g, '');
    if (!text.includes('members:')) return status(st, 'Paste the whole members list.', 'error');
    payload = { op, digest: await digestOf(text) };
  } else if (op === 'back' || op === 'stand') {
    payload = { op };
  } else if (op === 'contact') {
    let ticket;
    try {
      ticket = JSON.parse(value);
    } catch {
      return status(st, 'Paste the whole ticket from the case, the block in braces.', 'error');
    }
    if (typeof ticket.case !== 'string' || !Number.isInteger(ticket.round)) return status(st, 'That is not a case ticket.', 'error');
    const about = $('#op-about').value.trim().replace(/^@/, '');
    payload = { op, case: ticket.case, round: ticket.round, ...(about ? { about } : {}) };
  } else if (op === 'away' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return status(st, 'Give the day you are back, as YYYY-MM-DD.', 'error');
  } else if (!value) {
    return status(st, `Give the ${OPS[op].label.toLowerCase()}.`, 'error');
  } else {
    payload = op === 'login' ? { op, login: value, scope: $('#op-scope').value.trim() || 'default' }
      : op === 'unlogin' ? { op, login: value }
        : op === 'volunteer' ? { op, project: value }
          : op === 'away' ? { op, until: value }
            : { op, pool: value };
  }
  const file = await sealedRequest(me.key, me.pseudonym, payload, cfg.stewardKey);
  out.append(fileBlock(file.path, file.text), howTo([file.path], false));
  status(st, op === 'authorize' ? 'Add this file to the same pull request as your change.' : 'Ready. Put this file in a pull request of its own.', 'ok');
}

export function initRegister(config) {
  cfg = config;
  const fail = (el) => (e) => status($(el), `That did not work: ${e.message}.`, 'error');
  $('#unlock').addEventListener('click', () => unlock().catch(fail('#unlock-status')));
  $('#prepare-invite').addEventListener('click', () => prepareInvite().catch(fail('#invite-status')));
  $('#seal-request').addEventListener('click', () => sealOne().catch(fail('#request-status')));
  $('#op').addEventListener('change', showOp);
  showOp();
}

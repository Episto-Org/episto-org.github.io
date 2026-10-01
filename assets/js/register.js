// The account page's sealed requests: unlock with the Episto password,
// invite someone, and the other requests that tools/register.mjs makes.

import { h, $, clear, status } from './dom.js';
import { parseEntry } from './pools.js';
import { deriveKey, sealedRequest, digestOf, suggestPassword, MIN_PASSWORD } from '../lib/seals.js';
import { readBundle } from './bundle.js';
import { remember, recall, forget } from './remember.js';

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
  if ($('#remember').checked) {
    const until = await remember({ pseudonym, entry: $('#current').value, key });
    note += until ? ` Remembered on this device until ${until.toISOString().slice(0, 10)}.` : ' This browser would not keep it, so you will unlock again next time.';
    $('#forget').hidden = !until;
  }
  $('#my-password').value = '';
  status(out, `${note} Requests are checked by the steward against the members list.`, 'ok');
  showUnlocked();
}

function showUnlocked() {
  $('#invite').hidden = !cfg.sealedRegister;
  $('#requests').hidden = !cfg.sealedRegister;
}

/** Opens unlocked when "Remember me" was chosen on this device. */
async function restore() {
  const saved = await recall();
  if (!saved) return;
  me = { pseudonym: saved.pseudonym, key: saved.key };
  $('#me').value = saved.pseudonym;
  if (saved.entry && !$('#current').value.trim()) {
    $('#current').value = saved.entry;
    $('#current').dispatchEvent(new Event('input'));
  }
  $('#remember').checked = true;
  $('#forget').hidden = false;
  status($('#unlock-status'), `Unlocked as ${saved.pseudonym}, remembered on this device until ${saved.until.toISOString().slice(0, 10)}.`, 'ok');
  showUnlocked();
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
  rekey: { label: null, members: false },
  'vouch-rekey': { label: 'Their pseudonym', members: false },
  contact: { label: 'The ticket from the case (paste it)', members: false },
};

function showOp() {
  const op = OPS[$('#op').value];
  $('#op-value-box').hidden = !op.label;
  $('#op-value-label').textContent = op.label ?? '';
  $('#op-members-box').hidden = !op.members;
  $('#op-scope-box').hidden = $('#op').value !== 'login';
  $('#op-about-box').hidden = $('#op').value !== 'contact';
  $('#op-newpass-box').hidden = $('#op').value !== 'rekey';
  $('#op-key-box').hidden = $('#op').value !== 'vouch-rekey';
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
  } else if (op === 'rekey') {
    const pass = $('#op-newpass').value;
    if (pass.length < MIN_PASSWORD) return status(st, `The new password needs at least ${MIN_PASSWORD} characters.`, 'error');
    if (pass !== $('#op-newpass2').value) return status(st, 'The two new passwords differ.', 'error');
    status(st, 'Making your new key. This takes a few seconds.');
    payload = { op, key: (await deriveKey(me.pseudonym, pass)).publicLine };
  } else if (op === 'vouch-rekey') {
    const line = $('#op-key').value.trim().replace(/^key:\s*/, '').replace(/^"|"$/g, '').split(/\s+/).slice(0, 2).join(' ');
    if (!value) return status(st, 'Give their pseudonym.', 'error');
    if (!/^ssh-ed25519 [A-Za-z0-9+/]{68}$/.test(line)) return status(st, 'Paste the key line they sent you, starting ssh-ed25519.', 'error');
    payload = { op, for: value, key: line };
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
  status(st, op === 'authorize' ? 'Add this file to the same pull request as your change.'
    : op === 'vouch-rekey' ? 'Ready. Send this file to them: they put it in a pull request of their own, from their own GitHub account.'
      : op === 'rekey' ? 'Ready. Put this file in a pull request of its own. Your new password works 7 days after the steward records it; unlock with the old one until then.'
        : 'Ready. Put this file in a pull request of its own.', 'ok');
}

/** A new key for a lost password: the pseudonym stays, the key line changes. */
async function newKey() {
  const st = $('#np-status');
  const out = clear($('#np-out'));
  const pseudonym = $('#np-pseudonym').value.trim();
  const password = $('#np-password').value;
  if (!new RegExp(cfg.pseudonymPattern).test(pseudonym)) return status(st, 'Give your pseudonym exactly as in the members list.', 'error');
  if (password.length < MIN_PASSWORD) return status(st, `The password needs at least ${MIN_PASSWORD} characters.`, 'error');
  if (password !== $('#np-password2').value) return status(st, 'The two passwords differ.', 'error');
  status(st, 'Making your key. This takes a few seconds.');
  const key = await deriveKey(pseudonym, password);
  out.append(fileBlock('Your new key', key.publicLine, `Send it to your inviter (or a librarian) with your pseudonym, ${pseudonym}.`));
  status(st, 'Done. Your password is not stored anywhere: keep it safe.', 'ok');
}

export function initRegister(config) {
  cfg = config;
  const fail = (el) => (e) => status($(el), `That did not work: ${e.message}.`, 'error');
  $('#unlock').addEventListener('click', () => unlock().catch(fail('#unlock-status')));
  $('#prepare-invite').addEventListener('click', () => prepareInvite().catch(fail('#invite-status')));
  $('#seal-request').addEventListener('click', () => sealOne().catch(fail('#request-status')));
  $('#np-make').addEventListener('click', () => newKey().catch(fail('#np-status')));
  $('#forget').addEventListener('click', async () => {
    await forget();
    me = null;
    $('#forget').hidden = true;
    $('#remember').checked = false;
    $('#invite').hidden = true;
    $('#requests').hidden = true;
    status($('#unlock-status'), 'Forgotten on this device. Unlock with your password next time.', 'ok');
  });
  restore();
  $('#np-suggest').addEventListener('click', () => {
    const p = suggestPassword();
    $('#np-password').value = p;
    $('#np-password2').value = p;
    $('#np-suggested').textContent = p;
  });
  $('#op').addEventListener('change', showOp);
  showOp();
}

// The join page: writes a new member's members.yaml entry, with the public
// half of their password seal, and their first login request.

import { h, $, clear, download, status } from './dom.js';
import { loadPoolsConfig, explainer, picker, entryYaml, today, poolLabel } from './pools.js';
import { deriveKey, sealedRequest, suggestPassword, MIN_PASSWORD } from '../lib/seals.js';
import { writeBundle } from './bundle.js';

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
let cfg;
const selected = new Set();
let entry = null;

function steps(e) {
  const list = clear($('#next-steps'));
  list.append(h('li', null, 'Send this reply to your inviter the same private way the invitation reached you. It holds nothing about who you are; your GitHub username in it is sealed.'));
  list.append(h('li', null, `${e.invited_by} adds it on the account page and opens a pull request. The steward checks the invitation and merges it.`));
  list.append(h('li', null, 'An admin then gives your GitHub account read access to the members\' repository. From then on you work on GitHub\'s website, signed in with your GitHub password and two-step verification. Pages that act for you ask for your Episto password.'));
  list.append(h('li', null, 'Read the onboarding guide in the members\' repository. For your first three months you sit on panels as a shadow reviewer: your review is sealed and revealed like everyone\'s, but it does not count.'));
}

async function write(ev) {
  ev.preventDefault();
  const problems = [];
  const pseudonym = $('#pseudonym').value.trim();
  const inviter = $('#inviter').value.trim();
  const forge = $('#forge').value.trim();
  const password = $('#password').value;
  const pattern = new RegExp(cfg.pseudonymPattern);
  if (!pattern.test(pseudonym)) problems.push('the pseudonym must be 3-32 lower-case letters, digits and hyphens');
  if (!pattern.test(inviter)) problems.push('give your inviter\'s pseudonym');
  if (pseudonym && pseudonym === inviter) problems.push('you cannot invite yourself');
  if (!LOGIN.test(forge)) problems.push('give your GitHub username');
  if (password.length < MIN_PASSWORD) problems.push(`the password needs at least ${MIN_PASSWORD} characters`);
  else if (password !== $('#password2').value) problems.push('the two passwords differ');
  if (!selected.size) problems.push('choose at least one pool');
  const box = clear($('#join-problems'));
  if (problems.length) {
    box.append(h('span', { class: 'notice notice-error' }, `Please fix: ${problems.join('; ')}.`));
    $('#join-out').hidden = true;
    return;
  }
  status(box, 'Sealing. This takes a few seconds.');
  const key = await deriveKey(pseudonym, password);
  const day = today();
  entry = {
    pseudonym,
    ...(cfg.sealedRegister ? {} : { forge }),
    key: key.publicLine,
    invited_by: inviter,
    pools: Object.fromEntries([...selected].map((p) => [p, day])),
    joined: day,
    status: 'active',
  };
  const request = cfg.sealedRegister ? await sealedRequest(key, pseudonym, { op: 'login', login: forge, scope: 'default' }, cfg.stewardKey) : null;
  $('#entry').textContent = writeBundle(entryYaml(entry), request);
  clear(box).append(h('span', { class: 'notice notice-ok' },
    `Your pools: ${[...selected].map((p) => poolLabel(cfg, p)).join(', ')}. They count from the day you join. Pools you add after your first ${cfg.newMemberDays} days wait ${cfg.choiceDelayDays} days before they count.`));
  steps(entry);
  $('#join-out').hidden = false;
  $('#join-out').scrollIntoView({ block: 'start' });
}

async function main() {
  try {
    cfg = await loadPoolsConfig();
  } catch (e) {
    status($('#join-problems'), e.message, 'error');
    return;
  }
  $('#explainer').append(explainer(cfg));
  $('#picker').append(picker(cfg, selected, () => {}));
  $('#join-form').addEventListener('submit', (ev) => write(ev).catch((e) => status($('#join-problems'), `Sealing failed: ${e.message}. Use a current browser.`, 'error')));
  $('#suggest').addEventListener('click', () => {
    const p = suggestPassword();
    $('#password').value = p;
    $('#password2').value = p;
    $('#suggested').textContent = p;
  });
  $('#copy-entry').addEventListener('click', () => navigator.clipboard.writeText($('#entry').textContent));
  $('#save-entry').addEventListener('click', () => download(`episto-${entry.pseudonym}.txt`, $('#entry').textContent, 'text/plain'));
}

main();

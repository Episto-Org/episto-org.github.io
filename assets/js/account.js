// The account page: when pool choices count, and changing them.

import { h, $, clear, status, safeUrl } from './dom.js';
import { loadPoolsConfig, explainer, picker, entryYaml, parseEntry, listPools, today, effectiveDay, poolLabel } from './pools.js';
import { initRegister } from './register.js';

let cfg;
let entry = null;
let selected = new Set();

function readEntry() {
  const out = $('#current-status');
  clear($('#current-pools'));
  $('#change').hidden = true;
  $('#account-out').hidden = true;
  entry = null;
  const text = $('#current').value;
  if (!text.trim()) {
    out.textContent = '';
    return;
  }
  try {
    entry = parseEntry(text);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.joined ?? '')) throw new Error('the entry has no joining date');
    if (!entry.pools || typeof entry.pools !== 'object') throw new Error('the entry has no pools');
  } catch (e) {
    status(out, `That entry cannot be read: ${e.message}.`, 'error');
    return;
  }
  out.textContent = `${entry.pseudonym}, joined ${entry.joined}.`;
  $('#current-pools').append(h('p', null, h('strong', null, 'Your pools now')), listPools(cfg, entry.pools, entry.joined));
  selected = new Set(Object.keys(entry.pools));
  clear($('#picker')).append(picker(cfg, selected, update));
  $('#change').hidden = false;
}

function update() {
  const day = today();
  const before = entry.pools;
  const pools = {};
  for (const p of selected) pools[p] = before[p] ?? day;
  const added = [...selected].filter((p) => !before[p]);
  const removed = Object.keys(before).filter((p) => !selected.has(p));
  const box = clear($('#changes'));
  if (!added.length && !removed.length) {
    $('#account-out').hidden = true;
    return;
  }
  if (!selected.size) {
    box.append(h('p', { class: 'notice notice-error' }, 'Keep at least one pool. To stop reviewing for a while, ask to be paused instead.'));
    $('#account-out').hidden = true;
    return;
  }
  const items = [
    ...added.map((p) => {
      const from = effectiveDay(entry.joined, day, cfg);
      return h('li', null, `Join ${poolLabel(cfg, p)}: `, from === day ? 'counts at once (you joined recently)' : `counts from ${from}`);
    }),
    ...removed.map((p) => h('li', null, `Leave ${poolLabel(cfg, p)}: at once. Joining it again later starts the wait again.`)),
  ];
  box.append(h('p', null, h('strong', null, 'Changes')), h('ul', null, items));
  $('#entry').textContent = entryYaml({ ...entry, pools });
  const list = clear($('#next-steps'));
  list.append(h('li', null, 'On GitHub, in your fork, edit members.yaml: replace your entry with this one and change nothing else.'));
  if (cfg.sealedRegister) {
    list.append(h('li', null, 'Unlock below, choose "Authorize my change to the members list", paste the edited file, and add the sealed file it gives you to the same pull request.'));
  }
  list.append(h('li', null, 'The steward checks that only your pools changed and that new choices are dated today, then merges it.'));
  $('#account-out').hidden = false;
}

async function main() {
  try {
    cfg = await loadPoolsConfig();
  } catch (e) {
    status($('#current-status'), e.message, 'error');
    return;
  }
  $('#explainer').append(explainer(cfg));
  const url = cfg.membersUrl && safeUrl(cfg.membersUrl);
  if (url) {
    const link = $('#members-link');
    link.href = url;
    link.hidden = false;
  }
  $('#current').addEventListener('input', readEntry);
  initRegister(cfg);
  $('#copy-entry').addEventListener('click', () => navigator.clipboard.writeText($('#entry').textContent));
}

main();

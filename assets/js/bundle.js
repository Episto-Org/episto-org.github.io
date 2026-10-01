// The invitation reply a new member sends their inviter: their members.yaml
// entry, and (with the sealed register) their first login request, sealed so
// only the steward can read it.

const REQUEST = /^# login request: (register\/requests\/[a-z0-9-]{8,64}\.sealed)$/;

export function writeBundle(entryText, request) {
  const head = '# Episto invitation reply. Send it only to your inviter.\n';
  return head + entryText + (request ? `# login request: ${request.path}\n${request.text}` : '');
}

/** @returns {{entryText: string, request: {path, text} | null}} */
export function readBundle(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const entry = [];
  let request = null;
  for (let i = 0; i < lines.length; i++) {
    const m = REQUEST.exec(lines[i].trim());
    if (m) {
      const body = (lines[i + 1] ?? '').trim();
      if (!body.startsWith('{')) throw new Error('the login request is incomplete');
      request = { path: m[1], text: body + '\n' };
      i++;
    } else if (!lines[i].trim().startsWith('#') && lines[i].trim()) {
      entry.push(lines[i]);
    }
  }
  if (!entry.length) throw new Error('there is no entry in it');
  return { entryText: entry.join('\n') + '\n', request };
}

// "Remember me": keeps the member's pseudonym, entry and signing key in this
// browser for a while, so the account page opens unlocked. The key is kept
// as a key the browser can use but never export, so no script can read it
// out; the password is never stored. Anyone using this browser and profile
// can act as the member until it expires or "Forget me" is pressed.

const DB = 'episto';
const STORE = 'me';
export const REMEMBER_DAYS = 30;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function remember({ pseudonym, entry, key }) {
  const until = Date.now() + REMEMBER_DAYS * 86_400_000;
  try {
    await run('readwrite', (s) => s.put({ pseudonym, entry, privateKey: key.lockedKey, publicBlob: key.publicBlob, publicLine: key.publicLine, until }, 'me'));
    return new Date(until);
  } catch {
    return null;
  }
}

/** @returns {Promise<null | {pseudonym, entry, key, until: Date}>} */
export async function recall() {
  try {
    const v = await run('readonly', (s) => s.get('me'));
    if (!v) return null;
    if (!(v.until > Date.now()) || !v.privateKey) {
      await forget();
      return null;
    }
    return { pseudonym: v.pseudonym, entry: v.entry ?? '', key: { privateKey: v.privateKey, publicBlob: v.publicBlob, publicLine: v.publicLine }, until: new Date(v.until) };
  } catch {
    return null;
  }
}

export async function forget() {
  try {
    await run('readwrite', (s) => s.delete('me'));
  } catch {
    // nothing stored, or storage blocked
  }
}

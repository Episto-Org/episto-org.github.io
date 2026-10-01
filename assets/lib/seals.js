// Password seals and sealed requests, in the browser (and in Node, for tests).
//
// A member's Episto key is derived from their pseudonym and password, so
// there is no key file to keep: the same two always give the same key. The
// public half is an ordinary ssh-ed25519 key, and signatures use the SSHSIG
// format that ssh-keygen produces, so the steward checks them exactly as it
// checks a key made with ssh-keygen (tools/lib/sshsig.mjs).
//
// Requests to the steward are sealed with its public key in the same format
// as tools/lib/seal.mjs: RSA-OAEP (SHA-256) wrapping an AES-256-GCM key.

import { canonicalJson } from './commitment.js';

export const SEAL_VERSION = 'episto-seal-v1';
export const RECOVERY_VERSION = 'episto-recovery-v1';
export const KDF_ITERATIONS = 600000;
export const MIN_PASSWORD = 16;
export const NAMESPACE = 'episto-register';

const subtle = () => globalThis.crypto.subtle;
const utf8 = (s) => new TextEncoder().encode(s);
// PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410).
const PKCS8_ED25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function sshString(bytes) {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, bytes.length);
  return concat(len, bytes);
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * The member's key from pseudonym and password.
 * `lockedKey` signs the same way but can never be exported: it is the one
 * "Remember me" keeps in the browser.
 * @returns {Promise<{privateKey: CryptoKey, lockedKey: CryptoKey, publicBlob: Uint8Array, publicLine: string}>}
 */
export async function deriveKey(pseudonym, password, version = SEAL_VERSION) {
  const base = await subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const seed = new Uint8Array(await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: utf8(`${version}:${pseudonym}`), iterations: KDF_ITERATIONS }, base, 256));
  const privateKey = await subtle().importKey('pkcs8', concat(PKCS8_ED25519, seed), { name: 'Ed25519' }, true, ['sign']);
  const lockedKey = await subtle().importKey('pkcs8', concat(PKCS8_ED25519, seed), { name: 'Ed25519' }, false, ['sign']);
  const raw = fromBase64((await subtle().exportKey('jwk', privateKey)).x);
  const publicBlob = concat(sshString(utf8('ssh-ed25519')), sshString(raw));
  return { privateKey, lockedKey, publicBlob, publicLine: `ssh-ed25519 ${toBase64(publicBlob)}` };
}

/**
 * The recovery key: made from the pseudonym and the recovery code, salted
 * apart from the password key. It can only sign a request for a new key.
 */
export function deriveRecoveryKey(pseudonym, code) {
  return deriveKey(pseudonym, normalizeCode(code), RECOVERY_VERSION);
}

/** A recovery code: 25 characters in 5 groups, about 125 bits. */
export function suggestRecoveryCode() {
  return Array.from({ length: 5 }, () => suggestPassword().replace(/-/g, '').slice(0, 5)).join('-');
}

/** Codes are typed back by hand: case, spaces and dashes do not matter. */
export function normalizeCode(code) {
  return String(code).toLowerCase().replace(/[^a-z0-9]/g, '').match(/.{1,5}/g)?.join('-') ?? '';
}

/** An SSHSIG signature (armored, as ssh-keygen -Y sign writes it). */
export async function sshSign(key, message, namespace = NAMESPACE) {
  const ns = utf8(namespace);
  const alg = utf8('sha512');
  const digest = new Uint8Array(await subtle().digest('SHA-512', message));
  const magic = utf8('SSHSIG');
  const signed = concat(magic, sshString(ns), sshString(new Uint8Array(0)), sshString(alg), sshString(digest));
  const sig = new Uint8Array(await subtle().sign('Ed25519', key.privateKey, signed));
  const version = Uint8Array.from([0, 0, 0, 1]);
  const blob = concat(magic, version, sshString(key.publicBlob), sshString(ns), sshString(new Uint8Array(0)), sshString(alg),
    sshString(concat(sshString(utf8('ssh-ed25519')), sshString(sig))));
  const b64 = toBase64(blob).match(/.{1,70}/g).join('\n');
  return `-----BEGIN SSH SIGNATURE-----\n${b64}\n-----END SSH SIGNATURE-----\n`;
}

/** Seals a value so only the holder of the steward's private key can read it. */
export async function seal(value, publicKeyPem) {
  const der = fromBase64(publicKeyPem.replace(/-----[^-]+-----/g, ''));
  const rsa = await subtle().importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aesRaw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const aes = await subtle().importKey('raw', aesRaw, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, aes, utf8(JSON.stringify(value))));
  const ek = new Uint8Array(await subtle().encrypt({ name: 'RSA-OAEP' }, rsa, aesRaw));
  const kid = hex(await subtle().digest('SHA-256', der)).slice(0, 16);
  return { v: 1, alg: 'RSA-OAEP-256+A256GCM', kid, ek: toBase64(ek), iv: toBase64(iv), ct: toBase64(ct) };
}

export function randomHex(bytes) {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** sha256 of a text, as the steward computes it for authorize requests. */
export async function digestOf(text) {
  return hex(await subtle().digest('SHA-256', utf8(text)));
}

/**
 * A signed, sealed request to the steward (see tools/lib/requests.mjs).
 * @returns {Promise<{path: string, text: string}>} the file to add to the pull request
 */
export async function sealedRequest(key, member, payload, stewardPem) {
  const body = { v: 1, ...payload, member, day: today(), nonce: randomHex(16) };
  body.sig = await sshSign(key, utf8(canonicalJson(body)));
  return { path: `register/requests/${randomHex(8)}.sealed`, text: JSON.stringify(await seal(body, stewardPem)) + '\n' };
}

const ADJECTIVES = ('amber azure brisk calm cedar civic clear coral crisp dawn deep dry dusky early even fair fern fleet frost gentle gilded glad grand green hazel hollow ivory jade keen kind late level light lime linen lucid lunar maple mellow mild misty modest moss noble north oaken ochre olive pale pearl pine plain plum polar quiet rapid rare ready red river robust rose round royal ruby russet rustic sage sandy scarlet sharp silent silver slate sober solar south spare spruce steady still stone sunny swift tall tawny tidal topaz true umber vast velvet violet warm west wild willow windy winter woven young').split(' ');
const NOUNS = ('acorn alder anchor arch aspen badger basin beacon birch bison brook canyon cedar cliff comet compass cove crane creek delta dune eagle echo elm ember falcon fern field finch fjord forest fox glacier glade grove gull harbor hare hawk heron hill island ivy jay juniper kestrel lake lantern lark ledge lichen lynx maple marsh meadow mesa mink moor moth newt oak orchid osprey otter owl pebble pine plover pond prairie quail quarry rain raven reed ridge river robin sable sage shore sparrow spring spruce stone stork summit swan thrush tide trail tundra vale valley walnut willow wren yarrow').split(' ');

const DIGITS = Array.from({ length: 900 }, (_, i) => i);

function pick(list) {
  const limit = 65536 - (65536 % list.length);
  for (;;) {
    const v = globalThis.crypto.getRandomValues(new Uint16Array(1))[0];
    if (v < limit) return list[v % list.length];
  }
}

/**
 * A random pseudonym, such as "misty-heron-417": nothing in it comes from the
 * member, so it cannot point back to them. About 10 million combinations.
 */
export function suggestPseudonym() {
  const n = 100 + pick(DIGITS);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}

export const INVITE_DAYS = 30;

/** What an inviter signs: who invites, on which day, and a one-time nonce. */
export function inviteMessage(by, day, nonce) {
  return `episto-invite-v1|${by}|${day}|${nonce}`;
}

/**
 * An invitation from `by`, signed with their key: "<by>.<day>.<nonce>.<sig>".
 * The part after the pseudonym goes into the new member's entry as `invite`,
 * so anyone can check that the named inviter invited them.
 */
export async function signInvite(key, by, day = today()) {
  const nonce = randomHex(8);
  const sig = new Uint8Array(await subtle().sign('Ed25519', key.privateKey, utf8(inviteMessage(by, day, nonce))));
  return `${by}.${day}.${nonce}.${toBase64(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** @returns {null | {by, day, nonce, sig, code}} */
export function parseInvite(text) {
  const m = /^([a-z0-9][a-z0-9-]{2,31})\.(\d{4}-\d{2}-\d{2})\.([0-9a-f]{16})\.([A-Za-z0-9_-]{86})$/.exec(String(text).trim());
  return m ? { by: m[1], day: m[2], nonce: m[3], sig: m[4], code: `${m[2]}.${m[3]}.${m[4]}` } : null;
}

/**
 * A request to join: the new entry and the GitHub login, signed with the new
 * key and sealed to the steward. It goes in an issue on the intake
 * repository, opened from that same login.
 * @returns {Promise<string>} the sealed request (JSON)
 */
export async function sealedJoin(key, entry, login, stewardPem) {
  const body = { v: 1, op: 'join', entry, login, member: entry.pseudonym, day: today(), nonce: randomHex(16) };
  body.sig = await sshSign(key, utf8(canonicalJson(body)));
  return JSON.stringify(await seal(body, stewardPem));
}

/** A strong random password: 20 characters in 4 groups, about 100 bits. */
export function suggestPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const out = [];
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(40));
  for (const b of bytes) {
    if (b >= alphabet.length * Math.floor(256 / alphabet.length)) continue;
    out.push(alphabet[b % alphabet.length]);
    if (out.length === 20) break;
  }
  return out.join('').match(/.{5}/g).join('-');
}

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
 * @returns {Promise<{privateKey: CryptoKey, publicBlob: Uint8Array, publicLine: string}>}
 */
export async function deriveKey(pseudonym, password) {
  const base = await subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const seed = new Uint8Array(await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: utf8(`${SEAL_VERSION}:${pseudonym}`), iterations: KDF_ITERATIONS }, base, 256));
  const privateKey = await subtle().importKey('pkcs8', concat(PKCS8_ED25519, seed), { name: 'Ed25519' }, true, ['sign']);
  const raw = fromBase64((await subtle().exportKey('jwk', privateKey)).x);
  const publicBlob = concat(sshString(utf8('ssh-ed25519')), sshString(raw));
  return { privateKey, publicBlob, publicLine: `ssh-ed25519 ${toBase64(publicBlob)}` };
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

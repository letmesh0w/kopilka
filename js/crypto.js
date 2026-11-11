// Шифрование данных перед отправкой: AES-256-GCM, ключ из пароля через PBKDF2-SHA256.
// Пароль никуда не отправляется и не сохраняется; ключ живёт только в памяти открытой вкладки.

import { normalizeCode } from './guard.js';

export const ITERATIONS = 600000;
const te = new TextEncoder();
const td = new TextDecoder();

export function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));

export async function deriveKey(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // ключ нельзя выгрузить из браузера
    ['encrypt', 'decrypt'],
  );
}

export const AAD = te.encode('kopilka-sync-v1');      // файл в gist
export const LOCAL_AAD = te.encode('kopilka-local-v1'); // хранилище на устройстве

// JSON.stringify выполняется сразу при вызове, поэтому дальнейшие правки obj в шифр не попадут.
export async function seal(obj, key, saltB64, iterations, aad = AAD) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, te.encode(JSON.stringify(obj)));
  return { app: 'kopilka', v: 1, kdf: { name: 'PBKDF2-SHA256', iterations, salt: saltB64 }, cipher: 'AES-256-GCM', iv: toB64(iv), data: toB64(ct) };
}

export async function unseal(env, key, aad = AAD) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv), additionalData: aad }, key, fromB64(env.data));
  return JSON.parse(td.decode(pt));
}

// ---- сырой ключ (нужен, только чтобы завернуть его кодом восстановления) ----
export async function deriveRaw(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}
export const importRaw = raw => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

// ---- код восстановления: 120 случайных бит, 24 знака без похожих букв ----
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REC_AAD = te.encode('kopilka-recovery-v1');
const REC_ITER = 20000;
export function newRecoveryCode() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (let i = 0; i < 24; i++) s += ALPHA[b[i] & 31] + (i % 4 === 3 && i < 23 ? '-' : '');
  return s;
}
/** Заворачивает сырой ключ данных кодом восстановления. */
export async function wrapWithCode(raw, code) {
  const salt = newSalt();
  const k = await deriveKey(normalizeCode(code), salt, REC_ITER);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: REC_AAD }, k, raw);
  return { v: 1, salt: toB64(salt), iterations: REC_ITER, iv: toB64(iv), data: toB64(ct) };
}
export async function unwrapWithCode(rec, code) {
  const k = await deriveKey(normalizeCode(code), fromB64(rec.salt), Math.min(Number(rec.iterations) || REC_ITER, 5e6));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv), additionalData: REC_AAD }, k, fromB64(rec.data)));
}

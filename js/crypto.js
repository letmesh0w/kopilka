// Шифрование данных перед отправкой: AES-256-GCM, ключ из пароля через PBKDF2-SHA256.
// Пароль никуда не отправляется и не сохраняется; на устройстве хранится только неизвлекаемый ключ.

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

const AAD = te.encode('kopilka-sync-v1');

export async function seal(obj, key, saltB64, iterations) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, te.encode(JSON.stringify(obj)));
  return { app: 'kopilka', v: 1, kdf: { name: 'PBKDF2-SHA256', iterations, salt: saltB64 }, cipher: 'AES-256-GCM', iv: toB64(iv), data: toB64(ct) };
}

export async function unseal(env, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv), additionalData: AAD }, key, fromB64(env.data));
  return JSON.parse(td.decode(pt));
}

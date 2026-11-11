// Вход и синхронизация.
// Приложение открывается только по токену GitHub и паролю.
// В секретном gist данные зашифрованы ключом из пароля. На устройстве — ключом из токена и пароля вместе:
// украденное хранилище нельзя подбирать по паролю, не зная токена, и в нём не видно даже адреса gist.
// Ключи живут только в памяти открытой вкладки.
import {
  deriveKey, deriveRaw, importRaw, seal, unseal, newSalt, toB64, fromB64, ITERATIONS, LOCAL_AAD,
  newRecoveryCode, wrapWithCode, unwrapWithCode,
} from './crypto.js';
import { lockoutSeconds, WIPE_AFTER } from './guard.js';
import { merge, canon } from './merge.js';
import { migrate, LEGACY_KEY } from './store.js';

const VAULT = 'kopilka.vault';
const LAST = 'kopilka.syncLast';
const GUARD = 'kopilka.guard';
const FILE = 'kopilka.enc.json';
const DESC = 'Копилка: зашифрованная синхронизация (без пароля не читается)';
const BAD = 'Неверный токен или пароль.';

export class SyncError extends Error {}
/** В аккаунте GitHub нет копилки: можно создать новую (нужно подтвердить пароль). */
export class NeedCreate extends SyncError {}

// Адрес API подменяется только при локальной разработке: на сайте токен уходит исключительно на api.github.com.
const LOCAL_DEV = ['127.0.0.1', 'localhost'].includes(location.hostname);
const api = () => {
  if (LOCAL_DEV) { try { return localStorage.getItem('kopilka.apiBase') || 'https://api.github.com'; } catch { /* нет хранилища */ } }
  return 'https://api.github.com';
};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* приватный режим */ } },
};

let S = null; // { key, lkey, lsalt, token, gistId, salt, iterations, rec } — только в памяти

function readVault() {
  try {
    const v = JSON.parse(ls.get(VAULT));
    const it = v && v.kdf && Number(v.kdf.iterations);
    return v && v.app === 'kopilka-vault' && typeof v.iv === 'string' && typeof v.data === 'string' && typeof v.kdf.salt === 'string' && it >= 100000 && it <= 5000000 ? v : null;
  } catch { return null; }
}
export const hasVault = () => !!readVault();
export const isUnlocked = () => !!S;
export function sessionInfo() {
  if (!S) return null;
  return { gistId: S.gistId, last: Number(ls.get(LAST)) || 0, hasRecovery: S.rec === undefined ? null : !!S.rec };
}

// ---- GitHub API ----
async function gh(path, token, opts = {}) {
  let r;
  try {
    r = await fetch(api() + path, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new SyncError('Нет связи с GitHub. Проверьте интернет.');
  }
  if (r.status === 401) throw new SyncError('GitHub не принял токен: он неверный, отозван или истёк.');
  if (r.status === 403 || r.status === 404) throw new SyncError('У токена нет доступа к gist. При создании токена отметьте право gist.');
  if (!r.ok) throw new SyncError(`GitHub ответил ошибкой ${r.status}. Попробуйте позже.`);
  return r.json();
}

async function readEnvelope(gist) {
  const f = gist.files && gist.files[FILE];
  if (!f) throw new SyncError('В gist нет файла Копилки.');
  let text = f.content;
  if (f.truncated && typeof f.raw_url === 'string' && (LOCAL_DEV || f.raw_url.startsWith('https://gist.githubusercontent.com/'))) {
    try { text = await (await fetch(f.raw_url, { cache: 'no-store' })).text(); } catch { throw new SyncError('Не удалось скачать данные из gist.'); }
  }
  let env;
  try { env = JSON.parse(text); } catch { throw new SyncError('Файл в gist повреждён.'); }
  if (!env || env.app !== 'kopilka' || !env.kdf || typeof env.kdf.salt !== 'string' || typeof env.iv !== 'string' || typeof env.data !== 'string') throw new SyncError('Файл в gist не от Копилки.');
  // Подменённый файл не должен ни ослабить ключ, ни подвесить устройство бесконечным вычислением.
  const it = Number(env.kdf.iterations);
  if (!Number.isInteger(it) || it < 100000 || it > 5000000) throw new SyncError('Файл в gist повреждён.');
  return env;
}
async function openOrFail(env, key, msg) {
  try { return migrate(await unseal(env, key)); } catch { throw new SyncError(msg); }
}
const filesBody = env => JSON.stringify({ files: { [FILE]: { content: JSON.stringify(env) } } });
const findGist = list => list.find(g => g.files && g.files[FILE]);

// ---- защита от перебора на устройстве ----
function guardGet() {
  try { const g = JSON.parse(ls.get(GUARD)); return g && Number.isFinite(g.n) ? g : { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; }
}
const waitText = sec => (sec >= 90 ? `${Math.ceil(sec / 60)} мин` : `${Math.ceil(sec)} с`);
function guardCheck() {
  const g = guardGet();
  const left = (g.until - Date.now()) / 1000;
  if (left > 0) throw new SyncError(`Слишком много неверных попыток. Подождите ${waitText(Math.min(left, 600))}.`);
}
/** Считает неверную попытку. Возвращает текст ошибки. */
function guardFail() {
  const n = guardGet().n + 1;
  if (n >= WIPE_AFTER && readVault()) {
    forget();
    return `${WIPE_AFTER} неверных попыток подряд: данные с этого устройства удалены. Копия в облаке цела — войдите верными токеном и паролем.`;
  }
  const sec = lockoutSeconds(n);
  ls.set(GUARD, JSON.stringify({ n, until: Date.now() + sec * 1000 }));
  const left = WIPE_AFTER - n;
  return BAD + (sec ? ` Следующая попытка через ${waitText(sec)}.` : '') + (readVault() && left <= 5 ? ` Осталось попыток: ${left}, потом данные с этого устройства удалятся (в облаке останутся).` : '');
}
const guardOk = () => ls.del(GUARD);
export const attemptsInfo = () => guardGet();

// ---- хранилище на устройстве ----
const localSecret = (token, password) => `${token}\n${password}`;
let seq = 0, written = 0, gen = 0;
/** Шифрует и сохраняет состояние. Снимок данных берётся в момент вызова. */
export async function persistLocal(state) {
  if (!S) return false;
  const n = ++seq, g = gen;
  const s = S;
  const env = await seal({ gistId: s.gistId, gsalt: s.salt, giter: s.iterations, state }, s.lkey, s.lsalt, ITERATIONS, LOCAL_AAD);
  if (n < written || g !== gen) return true; // уже записано более новое или с устройства вышли
  written = n;
  return ls.set(VAULT, JSON.stringify({ ...env, app: 'kopilka-vault', tb: 1 }));
}

function dropLegacy() {
  ls.del(LEGACY_KEY);
  ls.del('kopilka.sync');
  try { indexedDB.deleteDatabase('kopilka'); } catch { /* не было */ }
}

async function openSession(token, password, { gistId, salt, iterations, key, rec }) {
  const lraw = newSalt();
  const lkey = await deriveKey(localSecret(token, password), lraw, ITERATIONS);
  S = { key, lkey, lsalt: toB64(lraw), token, gistId, salt, iterations, rec };
}

/** Пробует открыть хранилище устройства. null — не подошло. */
async function openVault(v, token, password) {
  try {
    if (v.tb) {
      const [lkey, box] = await (async () => {
        const k = await deriveKey(localSecret(token, password), fromB64(v.kdf.salt), v.kdf.iterations);
        return [k, await unseal(v, k, LOCAL_AAD)];
      })();
      const key = await deriveKey(password, fromB64(box.gsalt), box.giter);
      S = { key, lkey, lsalt: v.kdf.salt, token, gistId: box.gistId, salt: box.gsalt, iterations: box.giter, rec: undefined };
      return migrate(box.state);
    }
    // хранилище первой версии замка: ключ только из пароля, токен внутри
    const key = await deriveKey(password, fromB64(v.kdf.salt), v.kdf.iterations);
    const box = await unseal(v, key, LOCAL_AAD);
    if (box.token !== token) return null;
    await openSession(token, password, { gistId: v.gistId, salt: v.kdf.salt, iterations: v.kdf.iterations, key, rec: undefined });
    const state = migrate(box.state);
    await persistLocal(state);
    return state;
  } catch { return null; }
}

/** Новая соль, новый ключ из пароля, новый код восстановления. */
async function freshKeys(password) {
  const raw = newSalt();
  const bits = await deriveRaw(password, raw, ITERATIONS);
  const code = newRecoveryCode();
  return { salt: toB64(raw), iterations: ITERATIONS, key: await importRaw(bits), rec: await wrapWithCode(bits, code), code };
}
const sealGist = async (state, k) => ({ ...(await seal(state, k.key, k.salt, k.iterations)), ...(k.rec ? { rec: k.rec } : {}) });

/**
 * Вход. Сначала пробует хранилище устройства (без сети). Если оно не открылось — возможно, сменили токен или пароль
 * на другом устройстве: тогда копилка ищется в gist этого токена и расшифровывается паролем.
 * legacy — открытые данные старой версии на этом устройстве, они сливаются с облачными.
 * Возвращает { state, created, code } — code (код восстановления) только при создании.
 */
export async function unlock(token, password, { create = false, legacy = null, blank } = {}) {
  token = String(token || '').trim();
  if (!token || !password) throw new SyncError('Введите токен и пароль.');
  guardCheck();
  const v = readVault();
  if (v) {
    const state = await openVault(v, token, password);
    if (state) { guardOk(); return { state, created: false }; }
  }
  let list;
  try { list = await gh('/gists?per_page=100', token); } catch (e) {
    if (v || /не принял токен/.test(e.message)) throw new SyncError(guardFail());
    throw e;
  }
  const found = findGist(list);
  let state, k, gistId, code;
  if (found) {
    const env = await readEnvelope(await gh(`/gists/${found.id}`, token));
    k = { salt: env.kdf.salt, iterations: env.kdf.iterations, rec: env.rec || null };
    k.key = await deriveKey(password, fromB64(k.salt), k.iterations);
    let remote;
    try { remote = migrate(await unseal(env, k.key)); } catch { throw new SyncError(guardFail()); }
    state = legacy ? merge(legacy, remote) : remote;
    gistId = found.id;
    if (canon(state) !== canon(remote)) await gh(`/gists/${gistId}`, token, { method: 'PATCH', body: filesBody(await sealGist(state, k)) });
  } else {
    if (v) throw new SyncError(guardFail());
    if (!create) throw new NeedCreate('В этом аккаунте GitHub ещё нет копилки.');
    k = await freshKeys(password); code = k.code;
    state = legacy || blank;
    const g = await gh('/gists', token, {
      method: 'POST',
      body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(await sealGist(state, k)) } } }),
    });
    gistId = g.id;
  }
  await openSession(token, password, { gistId, ...k });
  if (!(await persistLocal(state))) { S = null; throw new SyncError('Браузер не даёт сохранять данные (приватный режим?).'); }
  ls.set(LAST, String(Date.now()));
  guardOk();
  dropLegacy();
  return { state, created: !found, code };
}

/** Перешифровывает облако и устройство новым паролем. Возвращает новый код восстановления. */
async function rekey(state, newPassword) {
  const s = S;
  const k = await freshKeys(newPassword);
  await gh(`/gists/${s.gistId}`, s.token, { method: 'PATCH', body: filesBody(await sealGist(state, k)) });
  await openSession(s.token, newPassword, { gistId: s.gistId, ...k });
  await persistLocal(state);
  ls.set(LAST, String(Date.now()));
  return k.code;
}

async function checkPassword(password) {
  const env = await readEnvelope(await gh(`/gists/${S.gistId}`, S.token));
  const bits = await deriveRaw(password, fromB64(env.kdf.salt), env.kdf.iterations);
  let remote;
  try { remote = migrate(await unseal(env, await importRaw(bits))); } catch { throw new SyncError('Текущий пароль неверный.'); }
  return { env, bits, remote };
}

/** Смена пароля (нужен текущий). Остальные устройства попросят войти с новым паролем. */
export async function changePassword(oldPassword, newPassword, local) {
  if (!S) throw new SyncError('Копилка заперта.');
  const { remote } = await checkPassword(oldPassword);
  const state = merge(local, remote);
  return { state, code: await rekey(state, newPassword) };
}

/** Новый код восстановления (нужен текущий пароль). Старый код перестаёт действовать. */
export async function newRecovery(password) {
  if (!S) throw new SyncError('Копилка заперта.');
  const { env, bits } = await checkPassword(password);
  const code = newRecoveryCode();
  const rec = await wrapWithCode(bits, code);
  await gh(`/gists/${S.gistId}`, S.token, { method: 'PATCH', body: filesBody({ ...env, rec }) });
  S.rec = rec;
  return code;
}

/** Забыли пароль: токен + код восстановления открывают облачную копию, задаётся новый пароль. */
export async function recover(token, code, newPassword, { legacy = null } = {}) {
  token = String(token || '').trim();
  guardCheck();
  let list;
  try { list = await gh('/gists?per_page=100', token); } catch (e) {
    if (/не принял токен/.test(e.message)) throw new SyncError(guardFail());
    throw e;
  }
  const found = findGist(list);
  if (!found) throw new SyncError('В этом аккаунте GitHub нет копилки.');
  const env = await readEnvelope(await gh(`/gists/${found.id}`, token));
  if (!env.rec) throw new SyncError('Для этой копилки код восстановления не создавали.');
  let remote;
  try { remote = migrate(await unseal(env, await importRaw(await unwrapWithCode(env.rec, code)))); } catch {
    guardFail();
    throw new SyncError('Код восстановления не подошёл.');
  }
  const state = legacy ? merge(legacy, remote) : remote;
  S = { token, gistId: found.id };
  let fresh;
  try { fresh = await rekey(state, newPassword); } catch (e) { S = null; throw e; }
  guardOk();
  dropLegacy();
  return { state, code: fresh };
}

/** Обычная синхронизация: забрать, слить, при необходимости отправить. */
export async function syncNow(local) {
  if (!S) return null;
  const s = S;
  const env = await readEnvelope(await gh(`/gists/${s.gistId}`, s.token));
  if (env.kdf.salt !== s.salt) throw new SyncError('Пароль сменили на другом устройстве. Заблокируйте копилку и войдите с новым паролем.');
  const remote = await openOrFail(env, s.key, 'Не удалось расшифровать данные из gist.');
  s.rec = env.rec || null;
  const merged = merge(local, remote);
  if (canon(merged) !== canon(remote)) {
    await gh(`/gists/${s.gistId}`, s.token, { method: 'PATCH', body: filesBody(await sealGist(merged, s)) });
  }
  ls.set(LAST, String(Date.now()));
  return { state: merged, changedLocal: canon(merged) !== canon(local) };
}

/** Запереть: ключи и токен исчезают из памяти, на устройстве остаётся только шифр. */
export function lock() { S = null; }

/** Выйти на этом устройстве: удалить шифрованное хранилище. Копия в gist остаётся. */
export function forget() {
  S = null; gen++;
  ls.del(VAULT); ls.del(LAST); ls.del(GUARD);
  dropLegacy();
}

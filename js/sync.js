// Вход и синхронизация.
// Приложение открывается только по токену GitHub и паролю. Данные на устройстве и в секретном gist
// зашифрованы одним ключом, который выводится из пароля и живёт только в памяти открытой вкладки.
import { deriveKey, seal, unseal, newSalt, toB64, fromB64, ITERATIONS, LOCAL_AAD } from './crypto.js';
import { merge, canon } from './merge.js';
import { migrate, LEGACY_KEY } from './store.js';

const VAULT = 'kopilka.vault';
const LAST = 'kopilka.syncLast';
const FILE = 'kopilka.enc.json';
const DESC = 'Копилка: зашифрованная синхронизация (без пароля не читается)';
const BAD = 'Неверный токен или пароль.';

export class SyncError extends Error {}
/** В аккаунте GitHub нет копилки: можно создать новую (нужно подтвердить пароль). */
export class NeedCreate extends SyncError {}

const api = () => {
  try { return localStorage.getItem('kopilka.apiBase') || 'https://api.github.com'; } catch { return 'https://api.github.com'; }
};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* приватный режим */ } },
};

let S = null; // { key, token, gistId, salt, iterations } — только в памяти

function readVault() {
  try {
    const v = JSON.parse(ls.get(VAULT));
    return v && v.app === 'kopilka-vault' && v.kdf && v.iv && v.data ? v : null;
  } catch { return null; }
}
export const hasVault = () => !!readVault();
export const isUnlocked = () => !!S;
export function sessionInfo() {
  if (!S) return null;
  return { gistId: S.gistId, last: Number(ls.get(LAST)) || 0 };
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
  if (f.truncated && f.raw_url) {
    try { text = await (await fetch(f.raw_url, { cache: 'no-store' })).text(); } catch { throw new SyncError('Не удалось скачать данные из gist.'); }
  }
  let env;
  try { env = JSON.parse(text); } catch { throw new SyncError('Файл в gist повреждён.'); }
  if (!env || env.app !== 'kopilka' || !env.kdf) throw new SyncError('Файл в gist не от Копилки.');
  return env;
}
async function openOrFail(env, key, msg) {
  try { return migrate(await unseal(env, key)); } catch { throw new SyncError(msg); }
}
const filesBody = env => JSON.stringify({ files: { [FILE]: { content: JSON.stringify(env) } } });
const findGist = list => list.find(g => g.files && g.files[FILE]);

// ---- хранилище на устройстве ----
let seq = 0, written = 0, gen = 0;
/** Шифрует и сохраняет состояние вместе с токеном. Снимок данных берётся в момент вызова. */
export async function persistLocal(state) {
  if (!S) return false;
  const n = ++seq, g = gen;
  const s = S;
  const env = await seal({ token: s.token, state }, s.key, s.salt, s.iterations, LOCAL_AAD);
  if (n < written || g !== gen) return true; // уже записано более новое или с устройства вышли
  written = n;
  return ls.set(VAULT, JSON.stringify({ ...env, app: 'kopilka-vault', gistId: s.gistId }));
}

function dropLegacy() {
  ls.del(LEGACY_KEY);
  ls.del('kopilka.sync');
  try { indexedDB.deleteDatabase('kopilka'); } catch { /* не было */ }
}

/**
 * Вход. Если на устройстве уже есть хранилище — проверяет пароль и токен без сети
 * (новый токен вместо истёкшего принимается, только если GitHub подтверждает, что gist принадлежит его владельцу).
 * Если хранилища нет — находит копилку в gist этого токена и расшифровывает паролем.
 * legacy — открытые данные старой версии на этом устройстве, они сливаются с облачными.
 */
export async function unlock(token, password, { create = false, legacy = null, blank } = {}) {
  token = String(token || '').trim();
  if (!token || !password) throw new SyncError('Введите токен и пароль.');
  const v = readVault();
  if (v) {
    const key = await deriveKey(password, fromB64(v.kdf.salt), v.kdf.iterations);
    let box;
    try { box = await unseal(v, key, LOCAL_AAD); } catch { throw new SyncError(BAD); }
    if (box.token !== token) {
      let own = false;
      try { own = !!(await gh('/gists?per_page=100', token)).find(g => g.id === v.gistId); } catch { own = false; }
      if (!own) throw new SyncError(BAD);
    }
    S = { key, token, gistId: v.gistId, salt: v.kdf.salt, iterations: v.kdf.iterations };
    const state = migrate(box.state);
    if (box.token !== token) await persistLocal(state);
    return { state, created: false };
  }

  const found = findGist(await gh('/gists?per_page=100', token));
  let state, gistId, salt, iterations, key;
  if (found) {
    const env = await readEnvelope(await gh(`/gists/${found.id}`, token));
    salt = env.kdf.salt; iterations = env.kdf.iterations;
    key = await deriveKey(password, fromB64(salt), iterations);
    const remote = await openOrFail(env, key, BAD);
    state = legacy ? merge(legacy, remote) : remote;
    gistId = found.id;
    if (canon(state) !== canon(remote)) {
      await gh(`/gists/${gistId}`, token, { method: 'PATCH', body: filesBody(await seal(state, key, salt, iterations)) });
    }
  } else {
    if (!create) throw new NeedCreate('В этом аккаунте GitHub ещё нет копилки.');
    iterations = ITERATIONS;
    const raw = newSalt();
    salt = toB64(raw);
    key = await deriveKey(password, raw, iterations);
    state = legacy || blank;
    const g = await gh('/gists', token, {
      method: 'POST',
      body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(await seal(state, key, salt, iterations)) } } }),
    });
    gistId = g.id;
  }
  S = { key, token, gistId, salt, iterations };
  if (!(await persistLocal(state))) throw new SyncError('Браузер не даёт сохранять данные (приватный режим?).');
  ls.set(LAST, String(Date.now()));
  dropLegacy();
  return { state, created: !found };
}

/** Обычная синхронизация: забрать, слить, при необходимости отправить. */
export async function syncNow(local) {
  if (!S) return null;
  const s = S;
  const env = await readEnvelope(await gh(`/gists/${s.gistId}`, s.token));
  if (env.kdf.salt !== s.salt) throw new SyncError('Копилку в gist пересоздали с другим паролем. Выйдите на этом устройстве и войдите заново.');
  const remote = await openOrFail(env, s.key, 'Не удалось расшифровать данные из gist.');
  const merged = merge(local, remote);
  if (canon(merged) !== canon(remote)) {
    await gh(`/gists/${s.gistId}`, s.token, { method: 'PATCH', body: filesBody(await seal(merged, s.key, s.salt, s.iterations)) });
  }
  ls.set(LAST, String(Date.now()));
  return { state: merged, changedLocal: canon(merged) !== canon(local) };
}

/** Запереть: ключ и токен исчезают из памяти, на устройстве остаётся только шифр. */
export function lock() { S = null; }

/** Выйти на этом устройстве: удалить шифрованное хранилище. Копия в gist остаётся. */
export function forget() {
  S = null; gen++;
  ls.del(VAULT); ls.del(LAST);
  dropLegacy();
}

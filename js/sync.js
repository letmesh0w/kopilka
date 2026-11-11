// Синхронизация через секретный GitHub Gist. В gist лежит только зашифрованный файл.
import { deriveKey, seal, unseal, newSalt, toB64, fromB64, ITERATIONS } from './crypto.js';
import { merge, canon } from './merge.js';
import { migrate } from './store.js';

const CFG_KEY = 'kopilka.sync';
const FILE = 'kopilka.enc.json';
const DESC = 'Копилка: зашифрованная синхронизация (без пароля не читается)';

export class SyncError extends Error {}

const api = () => {
  try { return localStorage.getItem('kopilka.apiBase') || 'https://api.github.com'; } catch { return 'https://api.github.com'; }
};

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; }
}
function setConfig(c) {
  try { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); } catch { /* приватный режим */ }
}

// ---- ключ в IndexedDB (неизвлекаемый CryptoKey) ----
let memKey = null;
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kopilka', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('keys', mode);
    const req = fn(t.objectStore('keys'));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
async function storeKey(key) {
  memKey = key;
  try { await idbDo('readwrite', s => s.put(key, 'sync')); } catch { /* останется в памяти до закрытия */ }
}
async function loadKey() {
  if (memKey) return memKey;
  try { memKey = await idbDo('readonly', s => s.get('sync')); } catch { memKey = null; }
  return memKey || null;
}
async function dropKey() {
  memKey = null;
  try { await idbDo('readwrite', s => s.delete('sync')); } catch { /* нечего удалять */ }
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

/**
 * Первое подключение устройства. Если gist Копилки уже есть — расшифровывает его этим паролем и сливает с локальными данными,
 * иначе создаёт новый. Возвращает слитое состояние.
 */
export async function connect(token, password, local) {
  token = token.trim();
  const list = await gh('/gists?per_page=100', token);
  const found = list.find(g => g.files && g.files[FILE]);
  let merged, gistId, saltB64, iterations;
  let key;
  if (found) {
    const env = await readEnvelope(await gh(`/gists/${found.id}`, token));
    saltB64 = env.kdf.salt; iterations = env.kdf.iterations;
    key = await deriveKey(password, fromB64(saltB64), iterations);
    const remote = await openOrFail(env, key, 'Неверный пароль синхронизации: данные в gist зашифрованы другим паролем.');
    merged = merge(local, remote);
    gistId = found.id;
    await gh(`/gists/${gistId}`, token, { method: 'PATCH', body: filesBody(await seal(merged, key, saltB64, iterations)) });
  } else {
    iterations = ITERATIONS;
    const salt = newSalt();
    saltB64 = toB64(salt);
    key = await deriveKey(password, salt, iterations);
    merged = local;
    const g = await gh('/gists', token, {
      method: 'POST',
      body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(await seal(merged, key, saltB64, iterations)) } } }),
    });
    gistId = g.id;
  }
  await storeKey(key);
  setConfig({ token, gistId, salt: saltB64, iterations, last: Date.now() });
  return { state: merged, created: !found };
}

/** Обычная синхронизация: забрать, слить, при необходимости отправить. */
export async function syncNow(local) {
  const cfg = getConfig();
  if (!cfg) return null;
  const key = await loadKey();
  if (!key) throw new SyncError('Ключ шифрования на этом устройстве потерян. Отключите синхронизацию и подключите заново с тем же паролем.');
  const env = await readEnvelope(await gh(`/gists/${cfg.gistId}`, cfg.token));
  if (env.kdf.salt !== cfg.salt) throw new SyncError('Пароль синхронизации сменили на другом устройстве. Отключите и подключите заново с новым паролем.');
  const remote = await openOrFail(env, key, 'Не удалось расшифровать данные из gist. Подключитесь заново.');
  const merged = merge(local, remote);
  const same = (a, b) => canon(a) === canon(b);
  if (!same(merged, remote)) {
    await gh(`/gists/${cfg.gistId}`, cfg.token, { method: 'PATCH', body: filesBody(await seal(merged, key, cfg.salt, cfg.iterations)) });
  }
  setConfig({ ...cfg, last: Date.now() });
  return { state: merged, changedLocal: !same(merged, local) };
}

export async function disconnect() {
  setConfig(null);
  await dropKey();
}

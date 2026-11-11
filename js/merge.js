// Слияние данных двух устройств и пометка изменений.
// Операции и записи веса сливаются поштучно (по id / дате) с учётом времени правки u и меток удаления;
// настройки, лимиты, правила и корзина — целиком, побеждает более поздняя правка.

export const SECTIONS = ['settings', 'limits', 'rules', 'basket'];

const txKey = t => t.id;
const wKey = w => w.date;
const strip = x => { const { u, ...rest } = x; return JSON.stringify(rest); };

export function emptyMeta() { return { sections: {}, deleted: {} }; }

function unionBy(xa = [], xb = [], keyf, prefix, deleted) {
  const m = new Map();
  for (const x of [...xa, ...xb]) {
    const k = keyf(x);
    const cur = m.get(k);
    if (!cur || (x.u || 0) > (cur.u || 0)) m.set(k, x);
  }
  return [...m.values()].filter(x => {
    const d = deleted[prefix + keyf(x)];
    return !d || (x.u || 0) > d;
  });
}

export function merge(local, remote) {
  const ma = local.meta || emptyMeta();
  const mb = remote.meta || emptyMeta();
  const out = { ...local };
  const sections = {};
  for (const s of SECTIONS) {
    const ta = ma.sections?.[s] || 0, tb = mb.sections?.[s] || 0;
    out[s] = tb > ta ? remote[s] : local[s];
    sections[s] = Math.max(ta, tb);
  }
  const deleted = { ...(ma.deleted || {}) };
  for (const [k, v] of Object.entries(mb.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, v);
  // метки удаления старше 400 дней больше не нужны
  const cutoff = Date.now() - 400 * 864e5;
  for (const k of Object.keys(deleted)) if (deleted[k] < cutoff) delete deleted[k];
  out.tx = unionBy(local.tx, remote.tx, txKey, 'tx:', deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  out.weights = unionBy(local.weights, remote.weights, wKey, 'w:', deleted).sort((a, b) => a.date.localeCompare(b.date));
  out.meta = { sections, deleted };
  return out;
}

// Снимок последнего сохранённого состояния, чтобы понять, что изменилось.
export function makeSnapshot(state) {
  return {
    sec: Object.fromEntries(SECTIONS.map(s => [s, JSON.stringify(state[s])])),
    tx: new Map(state.tx.map(t => [txKey(t), strip(t)])),
    w: new Map(state.weights.map(w => [wKey(w), strip(w)])),
  };
}

// Ставит время правки на изменённое и метки удаления на исчезнувшее. Возвращает true, если что-то изменилось.
export function stamp(state, snap, now = Date.now()) {
  if (!state.meta) state.meta = emptyMeta();
  const meta = state.meta;
  meta.sections ||= {}; meta.deleted ||= {};
  let changed = false;
  for (const s of SECTIONS) {
    if (JSON.stringify(state[s]) !== snap.sec[s]) { meta.sections[s] = now; changed = true; }
  }
  const pass = (list, keyf, prev, prefix) => {
    const seen = new Set();
    for (const x of list) {
      const k = keyf(x); seen.add(k);
      if (prev.get(k) !== strip(x)) { x.u = now; changed = true; }
    }
    for (const k of prev.keys()) if (!seen.has(k)) { meta.deleted[prefix + k] = now; changed = true; }
  };
  pass(state.tx, txKey, snap.tx, 'tx:');
  pass(state.weights, wKey, snap.w, 'w:');
  return changed;
}

// JSON с упорядоченными ключами: для сравнения состояний независимо от порядка полей.
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}

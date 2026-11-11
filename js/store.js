import { CATEGORIES, BASKET } from './data.js';
import { emptyMeta, makeSnapshot, stamp } from './merge.js';

const KEY = 'kopilka.v1';

export function defaultState() {
  return {
    version: 1,
    settings: {
      income: 0,          // ожидаемый доход в месяц до налога
      taxRate: 6,         // 4 — от физлиц, 6 — от юрлиц
      rent: 0,
      goalName: 'Мощный ПК и рабочее место',
      goalAmount: 350000,
      cushion: 0,         // подушка сверх цели (по желанию)
      initialSavings: 0,  // сколько уже было отложено до начала учёта
      startMonth: monthKey(today()),
      rememberRules: true,
      theme: 'auto',
    },
    limits: Object.fromEntries(CATEGORIES.filter(c => c.limit != null).map(c => [c.id, c.limit])),
    tx: [],
    rules: [],
    basket: {
      items: BASKET.map(b => ({ ...b })),
      week: isoWeek(today()),
      checked: {},
      history: [],
    },
    weights: [],
    meta: emptyMeta(),
  };
}

export let storageOk = true;

// Данные старой версии, лежавшие на устройстве открыто. После первого входа переносятся в шифрованное хранилище.
export function loadLegacy() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { storageOk = false; }
  if (!raw) return null;
  try { return migrate(JSON.parse(raw)); } catch { return null; }
}
export const LEGACY_KEY = KEY;

// Снимок последнего сохранения: по нему save() понимает, что изменилось, и помечает это для синхронизации.
let snap = null;
let onChange = null;
let persister = null;
export function setOnChange(fn) { onChange = fn; }
// Куда сохранять: задаётся после входа (шифрованное хранилище). До входа ничего не пишется.
export function setPersister(fn) { persister = fn; }
export function resetSnapshot(state) { snap = makeSnapshot(state); }

export function saveRaw(state) {
  if (!persister) return;
  persister(state).then(ok => { storageOk = ok !== false; });
}

export function save(state) {
  const changed = snap ? stamp(state, snap) : false;
  saveRaw(state);
  snap = makeSnapshot(state);
  if (changed && onChange) onChange();
}

// Дополняет старые или импортированные данные недостающими полями и приводит всё к ожидаемым типам:
// данные из файла копии или из облака не должны уметь подсунуть в страницу разметку или сломать её.
const CAT_IDS = new Set(CATEGORIES.map(c => c.id));
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const str = (x, max) => (typeof x === 'string' ? x : x == null ? '' : String(x)).slice(0, max);
const fin = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
const pos = (x, d = 0) => Math.max(0, fin(x, d));
const okId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x);
const okDate = x => typeof x === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x);
const okWeek = x => typeof x === 'string' && /^\d{4}-W\d{2}$/.test(x);
const stampMap = o => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k, v]) => k.length <= 60 && Number.isFinite(v)).slice(0, 20000));

function cleanTx(t) {
  if (!isObj(t) || !okDate(t.date)) return null;
  const o = { id: okId(t.id) ? t.id : uid(), date: t.date, cat: CAT_IDS.has(t.cat) ? t.cat : 'other', amount: fin(t.amount), note: str(t.note, 300) };
  if (t.src === 'import' || t.src === 'manual') o.src = t.src;
  if (Number.isFinite(t.ts)) o.ts = t.ts;
  if (Number.isFinite(t.u)) o.u = t.u;
  if (t.catManual) o.catManual = true;
  if (typeof t.hash === 'string') o.hash = t.hash.slice(0, 80);
  if (isObj(t.raw)) o.raw = { bankCat: str(t.raw.bankCat, 120), mcc: str(t.raw.mcc, 8), signed: fin(t.raw.signed) };
  return o;
}

export function migrate(s) {
  const d = defaultState();
  if (!isObj(s)) return d;
  const out = { version: 1 };
  const ss = isObj(s.settings) ? s.settings : {};
  out.settings = {
    income: pos(ss.income), taxRate: pos(ss.taxRate, 6), rent: pos(ss.rent),
    goalName: str(ss.goalName, 80) || d.settings.goalName, goalAmount: pos(ss.goalAmount, d.settings.goalAmount),
    cushion: pos(ss.cushion), initialSavings: pos(ss.initialSavings),
    startMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(ss.startMonth) ? ss.startMonth : d.settings.startMonth,
    rememberRules: ss.rememberRules !== false,
    theme: ['auto', 'light', 'dark'].includes(ss.theme) ? ss.theme : 'auto',
  };
  out.limits = { ...d.limits };
  for (const [k, v] of Object.entries(isObj(s.limits) ? s.limits : {})) if (CAT_IDS.has(k)) out.limits[k] = pos(v);
  out.tx = (Array.isArray(s.tx) ? s.tx : []).map(cleanTx).filter(Boolean);
  out.rules = (Array.isArray(s.rules) ? s.rules : []).filter(r => isObj(r) && typeof r.match === 'string' && r.match.trim() && CAT_IDS.has(r.cat))
    .slice(0, 500).map(r => ({ match: r.match.slice(0, 100), cat: r.cat }));
  const sb = isObj(s.basket) ? s.basket : {};
  const items = (Array.isArray(sb.items) ? sb.items : []).filter(isObj).slice(0, 300)
    .map(i => ({ id: okId(i.id) ? i.id : uid(), group: str(i.group, 60), name: str(i.name, 120), qty: str(i.qty, 60), price: pos(i.price) }));
  out.basket = {
    items: items.length ? items : d.basket.items,
    week: okWeek(sb.week) ? sb.week : d.basket.week,
    checked: Object.fromEntries(Object.keys(isObj(sb.checked) ? sb.checked : {}).filter(okId).map(k => [k, true])),
    history: (Array.isArray(sb.history) ? sb.history : []).filter(h => isObj(h) && okWeek(h.week)).slice(-200)
      .map(h => ({ week: h.week, planned: pos(h.planned), actual: pos(h.actual) })),
  };
  out.weights = (Array.isArray(s.weights) ? s.weights : []).filter(w => isObj(w) && okDate(w.date) && fin(w.kg) >= 20 && fin(w.kg) <= 400)
    .map(w => (Number.isFinite(w.u) ? { date: w.date, kg: fin(w.kg), u: w.u } : { date: w.date, kg: fin(w.kg) }));
  const m = isObj(s.meta) ? s.meta : {};
  out.meta = { sections: stampMap(m.sections), deleted: stampMap(m.deleted) };
  return out;
}

// ---- даты ----
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const monthKey = date => date.slice(0, 7);
export function addMonths(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function monthsBetween(a, b) { // включительно, a <= b
  const out = [];
  for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m);
  return out;
}
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function monthName(mk, short = false) {
  const [y, m] = mk.split('-').map(Number);
  const n = MONTHS[m - 1];
  return short ? n.slice(0, 3) : `${n[0].toUpperCase()}${n.slice(1)} ${y}`;
}
export function fmtDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
}
export function weekday(date) { // 0 = понедельник
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}
export function isoWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

// ---- прочее ----
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const money = n => `${nf.format(Math.round(n || 0))} ₽`;
export const num = n => nf.format(Math.round(n || 0));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

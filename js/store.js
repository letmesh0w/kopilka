import { CATEGORIES, BASKET } from './data.js';

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
  };
}

export let storageOk = true;

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { storageOk = false; }
  if (!raw) return defaultState();
  try { return migrate(JSON.parse(raw)); } catch { return defaultState(); }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch { storageOk = false; }
}

// Дополняет старые или импортированные данные недостающими полями.
export function migrate(s) {
  const d = defaultState();
  const out = { ...d, ...s };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  out.limits = { ...d.limits, ...(s.limits || {}) };
  out.basket = { ...d.basket, ...(s.basket || {}) };
  if (!Array.isArray(out.basket.items) || !out.basket.items.length) out.basket.items = d.basket.items;
  out.tx = Array.isArray(s.tx) ? s.tx : [];
  out.rules = Array.isArray(s.rules) ? s.rules : [];
  out.weights = Array.isArray(s.weights) ? s.weights : [];
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

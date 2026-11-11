import { CATEGORIES, CAT, NUTRITION } from './data.js';
import {
  load, saveRaw, resetSnapshot, setOnChange, save, migrate, defaultState, storageOk, today, monthKey, addMonths, monthName, fmtDate,
  isoWeek, weekday, daysBetween, uid, money, num, esc,
} from './store.js';
import { decodeBytes, parseCSV, findHeaderRow, detectColumns, rowsToOperations, opHash } from './csv.js';
import { categorize, merchantKey } from './categorize.js';
import {
  plan, limitFor, monthSummary, verdict, history, streak, forecast, habits, weightTrend, LIMITED, WD,
} from './analytics.js';
import { connect, syncNow, disconnect, getConfig, SyncError } from './sync.js';
import { merge } from './merge.js';
import { icon, catIcon } from './icons.js';

let state = load();
resetSnapshot(state);

const ui = {
  month: monthKey(today()),
  opsMonth: '',
  opsCat: '',
  opsQuery: '',
  habitsMonths: 3,
  imp: null,
  basketEdit: false,
};

// ---------- маршруты ----------
const R = {
  home: { t: 'Главная', ic: 'home' },
  ops: { t: 'Операции', ic: 'list' },
  habits: { t: 'Аналитика', ic: 'chart', more: true, d: 'Куда уходят деньги, привычки, подписки' },
  basket: { t: 'Корзина', ic: 'bag' },
  food: { t: 'Питание и вес', ic: 'utensils', more: true, d: 'Рацион, заготовки, рецепты, вес' },
  import: { t: 'Импорт выписки', ic: 'upload', more: true, d: 'Загрузить CSV из интернет-банка' },
  settings: { t: 'Настройки', ic: 'settings', more: true, d: 'Доход, цель, лимиты, синхронизация' },
  more: { t: 'Ещё', ic: 'more' },
};
const SIDE = ['home', 'ops', 'habits', 'basket', 'food', 'import', 'settings'];
const route = () => { const r = location.hash.slice(1); return R[r] ? r : 'home'; };
const go = r => { if (location.hash !== '#' + r) location.hash = '#' + r; else render(); };

const $app = document.getElementById('app');
const kind = id => (CAT[id] || CAT.other).kind;
const basketTotal = () => state.basket.items.reduce((a, i) => a + (Number(i.price) || 0), 0);
const FLEX = ['food', 'cafe', 'transport', 'home', 'health', 'clothes', 'fun', 'market', 'transfer', 'other'];
const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };

function persist() { save(state); }
function commit(msg) { save(state); render(); if (msg) toast(msg); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function weekRollover() {
  const w = isoWeek(today());
  if (state.basket.week !== w) { state.basket.week = w; state.basket.checked = {}; persist(); }
}

// ---------- синхронизация ----------
const sync = { busy: false, again: false, timer: null, error: '', tokenDraft: '' };
let pendingRender = false;
const isEditing = () => {
  const a = document.activeElement;
  return a && (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) && (document.getElementById('sheet-root').contains(a) || $app.contains(a));
};
function safeRender() {
  if (isEditing() || document.querySelector('.overlay')) { pendingRender = true; return; }
  pendingRender = false; render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !isEditing() && !document.querySelector('.overlay')) safeRender(); }, 0));

function applyRemote(remoteMerged) {
  state = merge(state, remoteMerged);
  saveRaw(state);
  resetSnapshot(state);
  safeRender();
}
function scheduleSync(delay = 2500) {
  if (!getConfig()) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, delay);
}
async function runSync() {
  if (!getConfig()) return;
  if (sync.busy) { sync.again = true; return; }
  sync.busy = true; sync.error = ''; showSync();
  try {
    const r = await syncNow(state);
    if (r && r.changedLocal) applyRemote(r.state);
  } catch (e) {
    sync.error = e instanceof SyncError ? e.message : 'Не удалось синхронизировать.';
    console.error(e);
  } finally {
    sync.busy = false; showSync();
    if (sync.again) { sync.again = false; runSync(); }
  }
}
function syncTime(ts) {
  if (!ts) return 'ещё не было';
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? `в ${hm}` : `${d.getDate()} ${MONTH_GEN[d.getMonth()]} в ${hm}`;
}
function syncChip() {
  const cfg = getConfig();
  if (!cfg) return '';
  const text = sync.busy ? 'Синхронизация…' : sync.error ? 'Ошибка синхронизации' : `Синхронизировано ${syncTime(cfg.last)}`;
  return `<a href="#settings" class="sync-chip${sync.error ? ' bad' : ''}" title="${esc(sync.error || 'Данные зашифрованы и синхронизируются через GitHub Gist')}">${icon(sync.error ? 'alert' : 'cloud')}${text}</a>`;
}
function showSync() {
  document.querySelectorAll('.sync-slot').forEach(el => { el.innerHTML = syncChip(); });
  const box = document.getElementById('sync-box');
  if (box && !isEditing()) box.innerHTML = syncBox();
}
setOnChange(() => scheduleSync());
document.addEventListener('visibilitychange', () => {
  const cfg = getConfig();
  if (document.visibilityState === 'visible' && cfg && Date.now() - (cfg.last || 0) > 20000) runSync();
});
window.addEventListener('online', () => runSync());

// ---------- общие куски ----------
function pageHead(title, sub = '', right = '') {
  const back = R[route()].more ? `<a class="back" href="#more" aria-label="Назад">${icon('back')}</a>` : '';
  return `<header class="page-head">${back}<div class="grow"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</header>`;
}

function signed(t) {
  const k = kind(t.cat);
  if (k === 'income') return ['plus', `+${money(t.amount)}`];
  if (k === 'save') return ['save', money(t.amount)];
  if (k === 'unsave') return ['', `−${money(t.amount)}`];
  if (k === 'internal') return ['faint', money(t.amount)];
  return t.amount < 0 ? ['plus', `+${money(-t.amount)}`] : ['', `−${money(t.amount)}`];
}

function opRow(t, { clickable = true, showDate = false } = {}) {
  const [cls, val] = signed(t);
  const name = CAT[t.cat]?.name || '';
  const title = t.note || name;
  const sub = [t.note ? name : '', showDate ? fmtDate(t.date) : ''].filter(Boolean).join(' · ');
  const tag = clickable ? 'button' : 'div';
  return `<${tag} class="row-item"${clickable ? ` data-act="edittx" data-id="${t.id}"` : ''}>${catIcon(t.cat)}
    <div class="body"><div class="t">${esc(title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>
    <div class="end"><div class="amt ${cls}">${val}</div></div></${tag}>`;
}

function columns(items, { ref = null, h = 150 } = {}) {
  const max = Math.max(1, ref || 0, ...items.map(i => i.value));
  const pct = v => (Math.max(0, v) / max) * 100;
  return `<div class="cols" style="--h:${h}px">
    ${items.map(i => `<div class="c" title="${esc(i.title)}"><div class="v ${i.cls || ''}" style="height:${pct(i.value)}%"></div><div class="top" style="bottom:${pct(i.value)}%">${esc(i.top ?? '')}</div></div>`).join('')}
    ${ref ? `<div class="ref" style="bottom:calc((100% - 20px) * ${pct(ref) / 100})"><span>план ${num(ref)}</span></div>` : ''}
  </div><div class="cols-labels">${items.map(i => `<span>${esc(i.label)}</span>`).join('')}</div>`;
}

function barHTML(spent, limit) {
  if (limit > 0) {
    const scale = Math.max(limit, spent);
    const base = (Math.min(spent, limit) / scale) * 100;
    const over = spent > limit ? ((spent - limit) / scale) * 100 : 0;
    return `<div class="bar${over ? ' has-marker' : ''}"><span style="width:${base}%"></span>${over ? `<span class="over" style="left:${base}%;width:${over}%"></span><i class="marker" style="left:calc(${base}% - 1px)"></i>` : ''}</div>`;
  }
  return `<div class="bar"><span style="width:${spent > 0 ? 100 : 0}%;opacity:.4"></span></div>`;
}

function ring(pct) {
  const r = 42, c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 96 96"><circle class="bg" cx="48" cy="48" r="${r}" fill="none" stroke-width="9"/>
    <circle class="fg" cx="48" cy="48" r="${r}" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.min(100, pct) / 100)).toFixed(1)}"/></svg>
    <div class="pct">${Math.floor(pct)}%</div></div>`;
}

function emptyState(ic, title, text, btns = '') {
  return `<div class="empty"><div class="big-ic">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btns ? `<div class="btns">${btns}</div>` : ''}</div>`;
}

const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };
const todayLong = () => `${WD_FULL[weekday(today())]}, ${fmtDate(today())}`;
function dayLabel(date) {
  const d = daysBetween(date, today());
  return d === 0 ? 'Сегодня' : d === 1 ? 'Вчера' : `${fmtDate(date)}, ${WD_FULL[weekday(date)]}`;
}

// ---------- Главная ----------
function vHome() {
  const s = state.settings;
  const p = plan(state);
  const f = forecast(state);
  const cur = monthKey(today());
  const mk = ui.month;
  const v = verdict(state, mk);
  let h = pageHead(greet(), `<span>${todayLong()}</span><span class="sync-slot">${syncChip()}</span>`);

  if (!s.income) {
    h += `<section class="card"><div class="empty" style="padding:8px 4px"><div class="big-ic">${icon('sparkle')}</div>
      <h3>Давайте настроим копилку</h3><p>Три вопроса о доходе и расходах, и приложение посчитает, сколько откладывать каждый месяц и когда наберётся нужная сумма.</p>
      <div class="btns"><button class="btn primary" data-act="setup">Настроить за минуту</button></div></div></section>`;
  }

  h += `<section class="hero"><div class="hero-top">${ring(f.pct)}
      <div><div class="label">Цель</div><div class="goal">${esc(s.goalName || 'Накопления')}</div>
      <div class="amount">${money(f.balance)}</div><div class="of">из ${money(f.target)}</div></div></div>
    <div class="hero-bottom"><div class="eta">${f.target > 0 && f.left === 0 ? 'Цель достигнута, можно покупать'
      : f.months != null ? `Осталось ${money(f.left)} · прогноз: ${monthName(f.doneMonth).toLowerCase()}` : 'Укажите доход, чтобы увидеть прогноз'}</div>
      <button class="btn sm" data-act="quicksave">${icon('plus')}Отложить</button></div></section>`;

  let daily = '';
  if (s.income) {
    const ms = monthSummary(state, cur);
    const lim = FLEX.reduce((a, id) => a + limitFor(state, id), 0);
    const spent = FLEX.reduce((a, id) => a + (ms.byCat[id] || 0), 0);
    const [y, m] = cur.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const daysLeft = dim - Number(today().slice(8, 10)) + 1;
    const left = lim - spent;
    daily = `<section class="card"><div class="card-head"><h2>Можно тратить в день</h2></div>
      <div class="big-num ${left < 0 ? 'bad' : ''}">${money(Math.max(0, left) / daysLeft)}</div>
      <p class="muted small mt">${left >= 0 ? `Осталось ${money(left)} на ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')} по гибким лимитам: еда, кафе, транспорт, покупки.`
        : `Гибкие лимиты превышены на ${money(-left)}. До конца месяца лучше обойтись самым необходимым.`}</p>
      <div class="mt">${barHTML(spent, lim)}</div></section>`;
  }
  const status = v.met ? `<span class="pill good">${icon('check')}План накоплений выполнен</span>`
    : p.savings > 0 ? `<span class="pill ${mk < cur ? 'bad' : 'neutral'}">${icon(mk < cur ? 'alert' : 'coins')}${mk < cur ? 'Не хватило' : 'Отложить ещё'} ${money(p.savings - v.saved)}</span>` : '';
  const month = `<section class="card"><div class="card-head"><h2>${monthName(mk)}</h2>
      <div class="month-switch"><button data-act="month" data-d="-1" aria-label="Предыдущий месяц">${icon('back')}</button>
      <button data-act="month" data-d="1" aria-label="Следующий месяц"${mk >= cur ? ' disabled' : ''}>${icon('chevron')}</button></div></div>
    <div class="stats">
      <div class="stat"><div class="k">Доход</div><div class="v">${money(v.income)}</div><div class="p">план ${num(p.income)}</div></div>
      <div class="stat"><div class="k">Траты</div><div class="v">${money(v.spent)}</div><div class="p">план ${num(p.spend)}</div></div>
      <div class="stat"><div class="k">Отложено</div><div class="v">${money(v.saved)}</div><div class="p">план ${num(Math.max(0, p.savings))}</div></div>
    </div>${status ? `<div class="mt">${status}</div>` : ''}</section>`;
  h += daily ? `<div class="cards2">${daily}${month}</div>` : month;

  const ids = ['tax', 'rent', ...LIMITED, ...Object.keys(v.byCat)].filter((x, i, a) => a.indexOf(x) === i && CAT[x] && CAT[x].kind === 'expense');
  const rowsData = ids.map(id => ({ id, spent: v.byCat[id] || 0, limit: limitFor(state, id) })).filter(r => r.spent > 0 || r.limit > 0);
  const active = rowsData.filter(r => r.spent > 0).sort((a, b) => b.spent - a.spent);
  const idle = rowsData.filter(r => r.spent === 0);
  const catRow = r => `<button class="row-item" data-act="opencat" data-cat="${r.id}">${catIcon(r.id, 'sm')}
      <div class="body"><div class="t">${esc(CAT[r.id].name)}</div>${barHTML(r.spent, r.limit)}</div>
      <div class="end"><div class="amt ${r.limit && r.spent > r.limit ? 'bad' : ''}">${num(r.spent)} ₽</div><div class="small faint">${r.limit ? `из ${num(r.limit)}` : 'вне плана'}</div></div></button>`;
  const budget = `<section class="card"><div class="card-head"><h2>Бюджет месяца</h2></div>
    ${active.length ? `<div class="rows">${active.map(catRow).join('')}</div>` : '<p class="muted">В этом месяце трат пока нет.</p>'}
    ${idle.length ? `<details class="fold"><summary>Без трат: ${idle.length} ${plural(idle.length, 'категория', 'категории', 'категорий')}${icon('chevron')}</summary><div class="rows">${idle.map(catRow).join('')}</div></details>` : ''}</section>`;

  const recentList = state.tx.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0)).slice(0, 5);
  const recent = `<section class="card"><div class="card-head"><h2>Последние операции</h2>${recentList.length ? `<a class="link" href="#ops">Все${icon('chevron')}</a>` : ''}</div>
    ${recentList.length ? `<div class="rows">${recentList.map(t => opRow(t, { showDate: true })).join('')}</div>`
      : emptyState('list', 'Пока пусто', 'Добавьте первую трату кнопкой «+» или загрузите выписку из банка.', `<button class="btn primary sm" data-act="add">${icon('plus')}Добавить</button><a class="btn sm" href="#import">${icon('upload')}Выписка</a>`)}</section>`;
  h += `<div class="cards2">${budget}${recent}</div>`;

  const hb = habits(state, 3, basketTotal());
  if (hb.insights.length) {
    h += `<section class="card"><div class="card-head"><h2>Наблюдение</h2><a class="link" href="#habits">Аналитика${icon('chevron')}</a></div>
      <div class="row-item" style="padding:0"><span class="cat-ic c-warn">${icon('bulb')}</span><div class="body" style="white-space:normal">${esc(hb.insights[0])}</div></div></section>`;
  }

  const ach = achievements();
  const hist = history(state).slice(-8);
  const histCard = `<section class="card"><div class="card-head"><h2>Отложено по месяцам</h2></div>
    ${hist.every(x => !x.saved) ? '<p class="muted">Пока ничего не отложено. Первый взнос можно сделать кнопкой «Отложить».</p>'
      : columns(hist.map(x => ({ label: monthName(x.month, true), value: x.saved, top: x.saved ? num(x.saved) : '', cls: x.month === cur ? (x.met ? '' : 'dim') : x.met ? '' : 'low', title: `${monthName(x.month)}: отложено ${money(x.saved)}, план ${money(x.plan)}` })), { ref: p.savings > 0 ? p.savings : null })}</section>`;
  const achCard = `<section class="card"><div class="card-head"><h2>Успехи</h2></div><div class="rows">${ach.map(a => `<div class="row-item"><span class="cat-ic sm c-${a.c}">${icon(a.ic)}</span>
      <div class="body"><div class="t" style="white-space:normal">${esc(a.t)}</div>${a.s ? `<div class="s" style="white-space:normal">${esc(a.s)}</div>` : ''}</div></div>`).join('')}</div></section>`;
  h += `<div class="cards2">${achCard}${histCard}</div>`;
  return h;
}

function achievements() {
  const out = [];
  const cur = monthKey(today());
  const p = plan(state);
  const done = history(state).filter(x => x.month < cur && x.count > 0);
  const met = done.filter(x => x.met).length;
  const st = streak(state);
  const f = forecast(state);
  if (f.left === 0 && f.target > 0) out.push({ c: 'good', ic: 'trophy', t: 'Цель накоплена', s: 'Можно выбирать комплектующие' });
  if (st >= 2) out.push({ c: 'warn', ic: 'flame', t: `${st} ${plural(st, 'месяц', 'месяца', 'месяцев')} подряд план выполнен`, s: 'Отличная серия, не прерывайте её' });
  if (done.length) out.push({ c: met === done.length ? 'good' : met ? 'accent' : 'bad', ic: met ? 'trophy' : 'alert', t: `План выполнен в ${met} из ${done.length} ${plural(done.length, 'месяца', 'месяцев', 'месяцев')}`, s: '' });
  const v = verdict(state, cur);
  if (p.savings > 0) {
    out.push(v.met ? { c: 'good', ic: 'check', t: 'В этом месяце план уже выполнен', s: 'Всё, что останется, тоже можно отложить' }
      : { c: 'accent', ic: 'coins', t: `В этом месяце осталось отложить ${money(p.savings - v.saved)}`, s: '' });
  }
  if (v.count) {
    out.push(v.over.length
      ? { c: 'bad', ic: 'alert', t: `Превышены лимиты: ${v.over.map(o => CAT[o.id].name.toLowerCase()).join(', ')}`, s: `Сверх плана ${money(v.over.reduce((a, o) => a + o.spent - o.limit, 0))}` }
      : { c: 'good', ic: 'check', t: 'Все лимиты месяца соблюдены', s: '' });
  }
  const bh = state.basket.history;
  if (bh.length) {
    const ok = bh.filter(b => b.actual <= b.planned * 1.05).length;
    out.push({ c: ok === bh.length ? 'good' : 'accent', ic: 'bag', t: `Корзина уложилась в план: ${ok} из ${bh.length} ${plural(bh.length, 'недели', 'недель', 'недель')}`, s: '' });
  }
  const wt = weightTrend(state.weights);
  if (wt) out.push({ c: wt.perWeek >= 0.25 && wt.perWeek <= 0.5 ? 'good' : 'accent', ic: 'scale', t: `Вес: ${wt.perWeek >= 0 ? '+' : '−'}${Math.abs(wt.perWeek).toFixed(2).replace('.', ',')} кг в неделю`, s: wt.advice });
  if (!out.length) out.push({ c: 'accent', ic: 'sparkle', t: 'Здесь появятся ваши успехи', s: 'Добавьте операции вручную или загрузите выписку' });
  return out;
}

// ---------- Операции ----------
function vOps() {
  const months = [...new Set(state.tx.map(t => monthKey(t.date)).concat(monthKey(today())))].sort().reverse();
  const h = pageHead('Операции', '', `<a class="icon-btn" href="#import" title="Загрузить выписку" aria-label="Загрузить выписку">${icon('upload')}</a>`);
  return h + `<div class="search">${icon('search')}<input class="input" type="search" data-filter="opsQuery" value="${esc(ui.opsQuery)}" placeholder="Поиск по описанию"></div>
  <div class="chips">
    <button class="chip" data-act="opsmonth" data-m="" aria-pressed="${!ui.opsMonth}">Все</button>
    ${months.map(m => `<button class="chip" data-act="opsmonth" data-m="${m}" aria-pressed="${ui.opsMonth === m}">${monthName(m).replace(' ' + new Date().getFullYear(), '')}</button>`).join('')}
    <select class="chip" data-filter="opsCat" aria-label="Категория"><option value="">Все категории</option>${CATEGORIES.map(c => `<option value="${c.id}"${c.id === ui.opsCat ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  </div>
  <div id="ops-list">${opsList()}</div>`;
}

function opsList() {
  const q = ui.opsQuery.trim().toLowerCase();
  const list = state.tx
    .filter(t => (!ui.opsMonth || monthKey(t.date) === ui.opsMonth) && (!ui.opsCat || t.cat === ui.opsCat) && (!q || (t.note || '').toLowerCase().includes(q) || (CAT[t.cat]?.name || '').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));
  if (!list.length) {
    return `<section class="card">${state.tx.length ? emptyState('search', 'Ничего не нашлось', 'Попробуйте другой месяц или категорию.')
      : emptyState('list', 'Операций пока нет', 'Добавьте трату кнопкой «+» или загрузите выписку из банка — так быстрее.', `<button class="btn primary sm" data-act="add">${icon('plus')}Добавить</button><a class="btn sm" href="#import">${icon('upload')}Загрузить выписку</a>`)}</section>`;
  }
  let inc = 0, exp = 0;
  for (const t of list) { const k = kind(t.cat); if (k === 'income') inc += t.amount; else if (k === 'expense') exp += t.amount; }
  let h = `<p class="muted small" style="margin:0 4px 10px">${list.length} ${plural(list.length, 'операция', 'операции', 'операций')} · поступления <span class="good">+${money(inc)}</span> · траты −${money(exp)}</p><section class="card"><div class="rows">`;
  let day = '';
  const dayTotals = {};
  for (const t of list) if (kind(t.cat) === 'expense') dayTotals[t.date] = (dayTotals[t.date] || 0) + t.amount;
  for (const t of list.slice(0, 500)) {
    if (t.date !== day) { day = t.date; h += `<div class="day-head"><span>${dayLabel(day)}</span><span class="num">${dayTotals[day] ? '−' + money(dayTotals[day]) : ''}</span></div>`; }
    h += opRow(t);
  }
  if (list.length > 500) h += `<p class="muted small" style="padding:10px 8px">Показаны первые 500. Уточните поиск.</p>`;
  return h + '</div></section>';
}

// ---------- лист снизу ----------
function openSheet(html) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="overlay" data-overlay><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div></div>`;
  document.body.style.overflow = 'hidden';
  const f = root.querySelector('[autofocus]');
  if (f) setTimeout(() => f.focus(), 60);
}
function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root.innerHTML) return;
  root.innerHTML = '';
  document.body.style.overflow = '';
  if (pendingRender) setTimeout(safeRender, 0);
}
const sheetHead = title => `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="close" aria-label="Закрыть">${icon('x')}</button></div>`;

// операция: добавить / изменить
const GROUPS = {
  expense: { label: 'Расход', cats: ['food', 'cafe', 'transport', 'market', 'home', 'fun', 'clothes', 'health', 'sport', 'bills', 'transfer', 'other', 'rent', 'tax', 'tech'] },
  income: { label: 'Доход', cats: ['income', 'income_other'] },
  piggy: { label: 'Копилка', cats: ['save', 'unsave', 'internal'] },
};
const groupOf = cat => { const k = kind(cat); return k === 'income' ? 'income' : k === 'expense' ? 'expense' : 'piggy'; };
let draft = null;

function openTx(tx, preset = {}) {
  draft = tx
    ? { id: tx.id, group: groupOf(tx.cat), cat: tx.cat, amount: String(Math.abs(tx.amount)), refund: tx.amount < 0, note: tx.note || '', date: tx.date, remember: state.settings.rememberRules }
    : { id: null, group: 'expense', cat: 'food', amount: '', refund: false, note: '', date: today(), remember: false, ...preset };
  openSheet(txSheet());
}
const SHORT = { 'Техника и ПК (цель)': 'ПК (цель)', 'Прочее и непредвиденное': 'Прочее', 'Развлечения и подписки': 'Развлечения', 'Связь и коммуналка': 'Связь, ЖКХ', 'Прочие поступления': 'Прочее', 'Переводы людям': 'Переводы' };
const CAT_LABEL = { save: 'Отложить', unsave: 'Взять', internal: 'Между счетами' };
function txSheet() {
  const d = draft;
  const g = GROUPS[d.group];
  const key = d.note ? merchantKey(d.note) : '';
  return `${sheetHead(d.id ? 'Операция' : 'Новая операция')}
  <div class="seg" role="group">${Object.entries(GROUPS).map(([k, x]) => `<button type="button" data-act="txgroup" data-g="${k}" aria-pressed="${d.group === k}">${x.label}</button>`).join('')}</div>
  <div class="amount-input"><input id="tx-amount" type="text" inputmode="decimal" placeholder="0" value="${esc(d.amount)}" autocomplete="off" aria-label="Сумма" style="width:${amountWidth(d.amount)}"${d.id ? '' : ' autofocus'}><span class="cur">₽</span></div>
  ${d.refund ? `<p class="small muted" style="text-align:center;margin:-8px 0 8px">Это возврат покупки: сумма уменьшает траты категории.</p>` : ''}
  <div class="cat-grid">${g.cats.map(c => `<button type="button" data-act="txcat" data-c="${c}" aria-pressed="${d.cat === c}">${catIcon(c)}<span>${esc(CAT_LABEL[c] || SHORT[CAT[c].name] || CAT[c].name)}</span></button>`).join('')}</div>
  <div class="fields two">
    <label class="field"><span>Комментарий</span><input class="input" id="tx-note" type="text" value="${esc(d.note)}" placeholder="Например, Пятёрочка"></label>
    <label class="field"><span>Дата</span><input class="input" id="tx-date" type="date" value="${esc(d.date)}"></label>
  </div>
  ${d.id && key ? `<label class="switch mt"><span>Всегда ставить эту категорию для «${esc(key)}»</span><input type="checkbox" id="tx-remember"${d.remember ? ' checked' : ''}></label>` : ''}
  <div class="actions">${d.id ? `<button class="btn danger icon-only" data-act="txdel" aria-label="Удалить" title="Удалить">${icon('trash')}</button>` : ''}
    <button class="btn primary" data-act="txsave">${d.id ? 'Сохранить' : 'Добавить'}</button></div>`;
}
const amountWidth = v => `${Math.max(1, String(v || '').length) * 0.62 + 0.3}em`;
function readDraft() {
  const a = document.getElementById('tx-amount'); if (a) draft.amount = a.value;
  const n = document.getElementById('tx-note'); if (n) draft.note = n.value;
  const dt = document.getElementById('tx-date'); if (dt) draft.date = dt.value;
  const r = document.getElementById('tx-remember'); if (r) draft.remember = r.checked;
}
function rerenderSheet(html) {
  const sh = document.querySelector('.sheet');
  if (sh) { const top = sh.scrollTop; sh.innerHTML = `<div class="grabber"></div>${html}`; sh.scrollTop = top; }
}
function saveDraft() {
  readDraft();
  const d = draft;
  const amount = Math.abs(Number(String(d.amount).replace(/\s/g, '').replace(',', '.')));
  if (!amount) { toast('Введите сумму'); document.getElementById('tx-amount')?.focus(); return; }
  const signedAmount = kind(d.cat) === 'expense' && d.refund ? -amount : amount;
  if (d.id) {
    const t = state.tx.find(x => x.id === d.id);
    if (!t) { closeSheet(); return; }
    const catChanged = t.cat !== d.cat;
    const oldKind = kind(t.cat);
    Object.assign(t, { cat: d.cat, amount: signedAmount, note: d.note.trim(), date: d.date || t.date });
    if (catChanged) t.catManual = true;
    let msg = 'Сохранено';
    if (catChanged && d.remember && t.note) {
      const key = merchantKey(t.note);
      state.rules = state.rules.filter(r => r.match !== key);
      state.rules.unshift({ match: key, cat: d.cat });
      let n = 0;
      for (const o of state.tx) {
        if (o.id !== t.id && !o.catManual && o.note && merchantKey(o.note) === key && kind(o.cat) === oldKind && o.cat !== d.cat) { o.cat = d.cat; n++; }
      }
      msg = `Запомнил: «${key}» → ${CAT[d.cat].name}${n ? `, обновлено ещё ${n}` : ''}`;
    }
    closeSheet(); commit(msg);
  } else {
    state.tx.push({ id: uid(), date: d.date || today(), cat: d.cat, amount: signedAmount, note: d.note.trim(), src: 'manual', ts: Date.now(), catManual: true });
    closeSheet(); commit(`${CAT[d.cat].name}: ${money(amount)}`);
  }
}

function openSetup() {
  const s = state.settings;
  openSheet(`${sheetHead('Настроим копилку')}
  <form data-form="setup" class="fields" autocomplete="off">
    <label class="field"><span>Сколько вы получаете в месяц, до налога</span><input class="input" name="income" type="number" inputmode="numeric" min="0" placeholder="150000" value="${s.income || ''}" required autofocus></label>
    <div class="field"><span>От кого в основном приходят деньги</span><div class="seg" role="group">
      <button type="button" data-act="setuptax" data-v="4" aria-pressed="${s.taxRate == 4}">Физлица · 4%</button>
      <button type="button" data-act="setuptax" data-v="6" aria-pressed="${s.taxRate != 4}">Компании · 6%</button></div>
      <input type="hidden" name="taxRate" value="${s.taxRate == 4 ? 4 : 6}"></div>
    <label class="field"><span>Аренда жилья в месяц</span><input class="input" name="rent" type="number" inputmode="numeric" min="0" placeholder="40000" value="${s.rent || ''}"></label>
    <label class="field"><span>На что копим</span><input class="input" name="goalName" type="text" value="${esc(s.goalName)}"></label>
    <div class="fields two">
      <label class="field"><span>Сколько нужно</span><input class="input" name="goalAmount" type="number" inputmode="numeric" min="0" value="${s.goalAmount || ''}"></label>
      <label class="field"><span>Уже отложено</span><input class="input" name="initialSavings" type="number" inputmode="numeric" min="0" placeholder="0" value="${s.initialSavings || ''}"></label>
    </div>
    <p class="small muted">Лимиты по категориям уже заданы по плану бюджета, их можно поменять в настройках.</p>
    <div class="actions"><button class="btn primary" type="submit">Готово</button></div>
  </form>`);
}

function openBuy() {
  const b = state.basket;
  const checked = b.items.filter(i => b.checked[i.id]).reduce((a, i) => a + (Number(i.price) || 0), 0);
  openSheet(`${sheetHead('Записать чек')}
  <p class="muted small">Сумма попадёт в траты «Продукты», а неделя — в статистику корзины.</p>
  <form data-form="bbuy" autocomplete="off">
    <div class="amount-input"><input name="sum" type="text" inputmode="decimal" style="width:${amountWidth(String(Math.round(checked || basketTotal())))}" value="${Math.round(checked || basketTotal())}" aria-label="Сумма чека" autofocus><span class="cur">₽</span></div>
    <label class="field"><span>Дата</span><input class="input" name="date" type="date" value="${today()}"></label>
    <div class="actions"><button class="btn primary" type="submit">Записать</button></div>
  </form>`);
}

// ---------- Корзина ----------
function vBasket() {
  const b = state.basket;
  const total = basketTotal();
  const doneItems = b.items.filter(i => b.checked[i.id]);
  const checkedSum = doneItems.reduce((a, i) => a + (Number(i.price) || 0), 0);
  const food = monthSummary(state, monthKey(today())).byCat.food || 0;
  const foodLimit = limitFor(state, 'food');
  const pct = b.items.length ? (doneItems.length / b.items.length) * 100 : 0;
  let h = pageHead('Корзина', `Неделя ${Number(b.week.slice(-2))} · отметки сбрасываются в понедельник`,
    `<button class="icon-btn" data-act="bedit" title="${ui.basketEdit ? 'Готово' : 'Изменить список'}" aria-label="${ui.basketEdit ? 'Готово' : 'Изменить список'}">${icon(ui.basketEdit ? 'check' : 'edit')}</button>`);
  h += `<section class="card"><div class="card-head"><h2>${doneItems.length === b.items.length && b.items.length ? 'Всё куплено' : `Куплено ${doneItems.length} из ${b.items.length}`}</h2><span class="num muted small">${money(checkedSum)} из ${money(total)}</span></div>
    <div class="bar"><span class="${pct === 100 ? 'done' : ''}" style="width:${pct}%"></span></div>
    <p class="small muted mt">Продукты в этом месяце: ${money(food)} из ${money(foodLimit)}</p></section>
  <section class="card"><ul class="shop">`;
  let g = null;
  for (const i of b.items) {
    if (i.group !== g) { g = i.group; h += `<li class="group">${esc(g || 'Прочее')}</li>`; }
    h += `<li class="item${b.checked[i.id] ? ' done' : ''}">
      <input type="checkbox" class="check-round" id="b-${esc(i.id)}" data-bcheck="${esc(i.id)}"${b.checked[i.id] ? ' checked' : ''}>
      <label for="b-${esc(i.id)}"><div class="n">${esc(i.name)}</div>${i.qty && i.qty !== '—' ? `<div class="q">${esc(i.qty)}</div>` : ''}</label>
      <input class="price" type="number" inputmode="numeric" min="0" value="${Number(i.price) || 0}" data-bprice="${esc(i.id)}" aria-label="Цена: ${esc(i.name)}">
      ${ui.basketEdit ? `<button class="icon-btn" data-act="bdel" data-id="${esc(i.id)}" aria-label="Убрать">${icon('x')}</button>` : ''}</li>`;
  }
  h += `</ul></section>`;
  if (ui.basketEdit) {
    h += `<section class="card"><div class="card-head"><h2>Добавить продукт</h2></div>
      <form data-form="badd" class="fields" autocomplete="off">
        <input class="input" name="name" placeholder="Название" required>
        <div class="fields two"><input class="input" name="qty" placeholder="Сколько, например 1 кг"><input class="input" name="price" type="number" inputmode="numeric" placeholder="Цена, ₽"></div>
        <button class="btn soft" type="submit">${icon('plus')}Добавить</button>
      </form>
      <div class="btns mt"><button class="btn sm" data-act="breset">Снять все отметки</button><button class="btn sm" data-act="bdefault">Вернуть список по умолчанию</button></div></section>`;
  }
  h += `<div class="sticky-cta"><button class="btn primary block" data-act="buy">${icon('receipt')}Записать чек</button></div>`;
  if (b.history.length) {
    h += `<section class="card"><div class="card-head"><h2>Прошлые недели</h2></div><div class="rows">
      ${b.history.slice().reverse().slice(0, 8).map(x => {
        const diff = x.actual - x.planned;
        return `<div class="row-item"><span class="cat-ic sm c-orange">${icon('bag')}</span><div class="body"><div class="t">Неделя ${Number(x.week.slice(-2))}</div><div class="s">план ${money(x.planned)}</div></div>
          <div class="end"><div class="amt">${money(x.actual)}</div><div class="small ${diff > 0 ? 'bad' : 'good'}">${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}</div></div></div>`;
      }).join('')}</div></section>`;
  }
  return h;
}

// ---------- Питание и вес ----------
function vFood() {
  const N = NUTRITION;
  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const wt = weightTrend(w);
  const last = w[w.length - 1];
  let h = pageHead('Питание и вес', 'Набор мышечной массы');
  h += `<section class="card"><div class="tiles">
    <div class="tile"><div class="v">2 900</div><div class="k">ккал в день</div></div>
    <div class="tile"><div class="v">150–165 г</div><div class="k">белка</div></div>
    <div class="tile"><div class="v">~80 г</div><div class="k">жиров</div></div>
    <div class="tile"><div class="v">350–400 г</div><div class="k">углеводов</div></div></div>
    <p class="small muted mt">Темп набора 0,25–0,5 кг в неделю: так растут мышцы, а не жир.</p></section>`;

  h += `<section class="card"><div class="card-head"><h2>Вес</h2>${wt ? `<span class="pill ${wt.perWeek >= 0.25 && wt.perWeek <= 0.5 ? 'good' : 'warn'}">${wt.perWeek >= 0 ? '+' : '−'}${Math.abs(wt.perWeek).toFixed(2).replace('.', ',')} кг/нед</span>` : ''}</div>
    ${last ? `<div class="big-num">${String(last.kg).replace('.', ',')} кг</div><p class="small muted">${dayLabel(last.date)}</p>` : ''}
    ${wt ? `<div class="notice mt">${icon('bulb')}<div>${esc(wt.advice)}</div></div>` : w.length ? '<p class="small muted mt">Для оценки темпа нужно хотя бы три записи за неделю и больше.</p>' : '<p class="muted">Взвешивайтесь утром натощак 2–3 раза в неделю, приложение посчитает темп.</p>'}
    ${w.length >= 2 ? lineChart(w.slice(-60)) : ''}
    <form class="fields mt" data-form="weight" autocomplete="off" style="grid-template-columns:1fr auto">
      <input class="input" name="kg" type="text" inputmode="decimal" placeholder="Вес сегодня, кг" required aria-label="Вес, кг">
      <button class="btn primary" type="submit">Записать</button></form>
    ${w.length ? `<details class="fold"><summary>Все записи${icon('chevron')}</summary><div class="rows">${w.slice().reverse().slice(0, 30).map(x => `<div class="row-item"><div class="body"><div class="t">${String(x.kg).replace('.', ',')} кг</div><div class="s">${dayLabel(x.date)}</div></div>
      <button class="icon-btn" data-act="wdel" data-date="${x.date}" aria-label="Удалить">${icon('trash')}</button></div>`).join('')}</div></details>` : ''}</section>`;

  h += `<div class="cards2"><section class="card"><div class="card-head"><h2>Рацион на день</h2></div>
    ${N.day.map(r => `<div class="meal"><div class="body"><div class="t">${esc(r[0])}</div><div class="what">${esc(r[1])}</div></div><div class="kc"><b>${r[2]}</b> ккал<br>${r[3]} г белка</div></div>`).join('')}</section>
  <section class="card"><div class="card-head"><h2>Заготовки на воскресенье</h2><span class="muted small">2–2,5 ч</span></div>
    <ol class="steps">${N.prep.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ol></section></div>
  <section class="card"><div class="card-head"><h2>Рецепты</h2></div>
    ${N.recipes.map(r => `<details class="fold"><summary>${esc(r.title)}${icon('chevron')}</summary><div>${r.ingredients ? `<p class="small muted" style="margin-bottom:8px">${esc(r.ingredients)}</p>` : ''}<ol class="steps">${r.steps.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ol></div></details>`).join('')}</section>
  <section class="card"><div class="card-head"><h2>Хранение</h2></div>${N.storage.map(s => `<div class="notice" style="margin-bottom:8px">${icon('alert')}<div>${esc(s)}</div></div>`).join('')}</section>`;
  return h;
}

function lineChart(points) {
  const ys = points.map(p => p.kg);
  const min = Math.min(...ys) - 0.3, max = Math.max(...ys) + 0.3;
  const n = points.length;
  const xy = points.map((p, i) => [(i / (n - 1)) * 100, ((max - p.kg) / (max - min)) * 100]);
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');
  const f = v => v.toFixed(1).replace('.', ',');
  return `<div class="line-chart" title="Вес: от ${f(Math.min(...ys))} до ${f(Math.max(...ys))} кг">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="График веса"><path class="a" d="${line}L100,100L0,100Z"/><path class="l" d="${line}"/></svg>
    <span class="y" style="top:0">${f(max)}</span><span class="y" style="bottom:0">${f(min)}</span></div>
    <div class="line-axis"><span>${fmtDate(points[0].date)}</span><span>${fmtDate(points[n - 1].date)}</span></div>`;
}

// ---------- Аналитика ----------
function vHabits() {
  const hb = habits(state, ui.habitsMonths, basketTotal());
  let h = pageHead('Аналитика', 'Куда уходят деньги');
  h += `<div class="seg" role="group" style="margin-bottom:14px">${[[1, 'Месяц'], [3, '3 месяца'], [6, 'Полгода'], [12, 'Год']].map(([n, l]) => `<button data-act="hmonths" data-n="${n}" aria-pressed="${n === ui.habitsMonths}">${l}</button>`).join('')}</div>`;
  if (!hb.catAvg.length) {
    return h + `<section class="card">${emptyState('chart', 'Пока нечего анализировать', 'Загрузите выписку из банка или добавьте операции, и здесь появятся привычки в тратах.', `<a class="btn primary sm" href="#import">${icon('upload')}Загрузить выписку</a>`)}</section>`;
  }
  if (hb.insights.length) {
    h += `<section class="card"><div class="card-head"><h2>Что заметно</h2></div><div class="rows">${hb.insights.map(s => `<div class="row-item"><span class="cat-ic sm c-warn">${icon('bulb')}</span><div class="body" style="font-size:15px">${esc(s)}</div></div>`).join('')}</div></section>`;
  }
  const maxAvg = Math.max(...hb.catAvg.map(c => Math.max(c.avg, c.limit)));
  h += `<section class="card"><div class="card-head"><h2>В среднем за месяц</h2><span class="small muted">риска — лимит</span></div><div class="rows">${hb.catAvg.map(c => {
    const over = c.limit > 0 && c.avg > c.limit;
    return `<button class="row-item" data-act="opencat" data-cat="${c.cat}">${catIcon(c.cat, 'sm')}<div class="body"><div class="t">${esc(CAT[c.cat].name)}</div>
      <div class="bar has-marker"><span class="${over ? 'over' : ''}" style="width:${(c.avg / maxAvg) * 100}%"></span>${c.limit ? `<i class="marker" style="left:calc(${(c.limit / maxAvg) * 100}% - 1px)"></i>` : ''}</div></div>
      <div class="end"><div class="amt ${over ? 'bad' : ''}">${num(c.avg)} ₽</div>${c.limit ? `<div class="small faint">лимит ${num(c.limit)}</div>` : ''}</div></button>`;
  }).join('')}</div></section>`;
  h += `<div class="cards2"><section class="card"><div class="card-head"><h2>По дням недели</h2></div>
    ${columns(hb.wd.map((w, i) => ({ label: WD[i], value: w.sum, top: w.sum ? num(w.sum) : '', title: `${WD_FULL[i]}: ${money(w.sum)}, ${w.count} ${plural(w.count, 'покупка', 'покупки', 'покупок')}` })), { h: 140 })}
    <p class="small muted mt">Без аренды, налога и переводов людям.</p></section>
  <section class="card"><div class="card-head"><h2>Где тратится больше всего</h2></div><div class="rows">${hb.top.slice(0, 7).map(m => `<div class="row-item">${catIcon(m.cat, 'sm')}
    <div class="body"><div class="t">${esc(m.key)}</div><div class="s">${m.count} ${plural(m.count, 'раз', 'раза', 'раз')}</div></div><div class="end"><div class="amt">${money(m.sum)}</div></div></div>`).join('')}</div></section></div>`;
  if (hb.subs.length) {
    h += `<section class="card"><div class="card-head"><h2>Регулярные платежи</h2><span class="small muted">${money(hb.subs.reduce((a, s) => a + s.monthly, 0))} в месяц</span></div><div class="rows">
      ${hb.subs.map(s => `<div class="row-item"><span class="cat-ic sm c-violet">${icon('repeat')}</span><div class="body"><div class="t">${esc(s.key)}</div></div><div class="end"><div class="amt">${money(s.monthly)}</div></div></div>`).join('')}</div></section>`;
  }
  if (hb.deltas.length) {
    h += `<section class="card"><div class="card-head"><h2>Этот месяц и прошлый</h2><span class="small muted">прошло ${hb.elapsed} ${plural(hb.elapsed, 'день', 'дня', 'дней')}</span></div><div class="rows">
      ${hb.deltas.slice(0, 10).map(d => {
        const diff = d.now - d.prev;
        return `<div class="row-item">${catIcon(d.cat, 'sm')}<div class="body"><div class="t">${esc(CAT[d.cat]?.name || d.cat)}</div><div class="s">было ${money(d.prev)} · сейчас ${money(d.now)}</div></div>
          <div class="end"><span class="pill ${diff > 0 ? 'bad' : diff < 0 ? 'good' : 'neutral'}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${num(Math.abs(diff))}</span></div></div>`;
      }).join('')}</div></section>`;
  }
  return h;
}

// ---------- Импорт ----------
const FIELDS = [
  ['date', 'Дата'], ['amount', 'Сумма (или «Расход»)'], ['income', 'Приход, если отдельно'],
  ['desc', 'Описание'], ['bankCat', 'Категория банка'], ['mcc', 'MCC'], ['status', 'Статус'],
];
function importPreview() {
  const { rows, hi, map } = ui.imp;
  const { ops, errors } = rowsToOperations(rows, hi, map);
  const have = new Set(state.tx.map(t => t.hash).filter(Boolean));
  return { items: ops.map(op => { const hash = opHash(op); return { op, hash, dup: have.has(hash), ...categorize(op, state.rules) }; }), errors };
}
function vImport() {
  let h = pageHead('Импорт выписки', 'CSV из интернет-банка');
  h += `<section class="card"><div class="drop" id="drop"><div class="big-ic">${icon('upload')}</div>
    <h3 style="font-size:17px;margin-bottom:4px">Перетащите файл сюда</h3><p class="muted small">или выберите его. Файл читается прямо на устройстве и никуда не отправляется.</p>
    <div class="btns" style="justify-content:center;margin-top:14px"><label class="btn primary"><input type="file" id="csvfile" accept=".csv,.txt,text/csv" hidden>${icon('file')}Выбрать CSV</label></div></div>
    <details class="fold"><summary>Где взять CSV${icon('chevron')}</summary><div><ol class="steps">
      <li><span>Откройте интернет-банк в браузере на компьютере: в мобильных приложениях выгрузка в CSV есть не везде.</span></li>
      <li><span>В разделе операций или выписок выберите период и формат CSV. Если есть только Excel, откройте файл и сохраните как CSV.</span></li>
      <li><span>PDF-выписки приложение не читает.</span></li>
      <li><span>Пересекающиеся периоды загружать можно: уже добавленные операции пропускаются.</span></li></ol></div></details></section>`;
  if (ui.imp) h += `<div id="imp-body">${importBody()}</div>`;
  return h;
}
function importBody() {
  const { rows, hi, map, name } = ui.imp;
  const header = rows[hi] || [];
  const { items, errors } = importPreview();
  const fresh = items.filter(i => !i.dup);
  const dates = items.map(i => i.op.date).sort();
  let h = `<section class="card"><div class="row-item" style="padding:0 0 12px"><span class="cat-ic c-accent">${icon('file')}</span><div class="body"><div class="t">${esc(name)}</div>
    <div class="s">${items.length} ${plural(items.length, 'операция', 'операции', 'операций')}${dates.length ? ` · ${fmtDate(dates[0])} — ${fmtDate(dates[dates.length - 1])}` : ''}</div></div></div>
    <div class="btns" style="margin-bottom:12px"><span class="pill good">${icon('plus')}Новых: ${fresh.length}</span>${items.length - fresh.length ? `<span class="pill neutral">Уже есть: ${items.length - fresh.length}</span>` : ''}${errors.length ? `<span class="pill warn">Не разобрано строк: ${errors.length}</span>` : ''}</div>`;
  if (!items.length) h += `<div class="notice bad">${icon('alert')}<div>Не получилось найти операции. Откройте «Столбцы» ниже и проверьте, где дата и сумма.</div></div>`;
  else h += `<div class="btns"><button class="btn primary" data-act="doimport"${fresh.length ? '' : ' disabled'}>Добавить ${fresh.length} ${plural(fresh.length, 'операцию', 'операции', 'операций')}</button><button class="btn" data-act="cancelimport">Отмена</button></div>`;
  h += `<details class="fold"${items.length ? '' : ' open'}><summary>Столбцы определены автоматически${icon('chevron')}</summary><div class="fields two">
    ${FIELDS.map(([k, label]) => `<label class="field"><span>${label}</span><select class="input" data-map="${k}"><option value="-1">— нет —</option>${header.map((c, i) => `<option value="${i}"${map[k] === i ? ' selected' : ''}>${esc(c || `столбец ${i + 1}`)}</option>`).join('')}</select></label>`).join('')}
    <label class="field"><span>Строка заголовка</span><input class="input" type="number" min="1" max="${rows.length}" value="${hi + 1}" data-map="hi"></label></div>
    <label class="switch mt"><span>Траты в файле записаны положительными числами</span><input type="checkbox" data-map="invert"${map.invert ? ' checked' : ''}></label></details></section>`;
  if (items.length) {
    h += `<section class="card"><div class="card-head"><h2>Так будет</h2><span class="small muted">первые ${Math.min(30, items.length)}</span></div><div class="rows">
      ${items.slice(0, 30).map(i => `<div style="${i.dup ? 'opacity:.45' : ''}">${opRow({ id: '', date: i.op.date, cat: i.cat, amount: i.amount, note: i.op.desc }, { clickable: false, showDate: true })}</div>`).join('')}</div>
      <p class="small muted mt">Категории можно поправить после импорта: нажмите на операцию.</p></section>`;
  }
  return h;
}
async function readCSV(file) {
  if (/\.(xlsx?|pdf)$/i.test(file.name)) { toast('Нужен CSV. Excel сохраните как CSV, PDF не поддерживается.'); return; }
  const rows = parseCSV(decodeBytes(await file.arrayBuffer()));
  if (!rows.length) { toast('Файл пустой'); return; }
  const hi = findHeaderRow(rows);
  ui.imp = { name: file.name, rows, hi, map: { ...detectColumns(rows[hi]), invert: false } };
  render();
  document.getElementById('imp-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function doImport() {
  const { items } = importPreview();
  let n = 0;
  const ts = Date.now();
  for (const i of items) {
    if (i.dup) continue;
    state.tx.push({ id: uid(), date: i.op.date, cat: i.cat, amount: i.amount, note: i.op.desc, src: 'import', hash: i.hash, ts: ts + n, raw: { signed: i.op.signedAmount, bankCat: i.op.bankCat, mcc: i.op.mcc } });
    n++;
  }
  ui.imp = null; ui.opsMonth = ''; ui.opsCat = '';
  save(state);
  go('ops');
  toast(`Добавлено: ${n} ${plural(n, 'операция', 'операции', 'операций')}`);
}

// ---------- Настройки ----------
function syncBox() {
  const cfg = getConfig();
  if (cfg) {
    return `<div class="row-item" style="padding:0 0 12px"><span class="cat-ic c-${sync.error ? 'bad' : 'good'}">${icon(sync.error ? 'alert' : 'lock')}</span>
      <div class="body"><div class="t">${sync.error ? 'Ошибка синхронизации' : 'Синхронизация включена'}</div><div class="s">Последний обмен ${syncTime(cfg.last)}</div></div></div>
      ${sync.error ? `<div class="notice bad" style="margin-bottom:12px">${icon('alert')}<div>${esc(sync.error)}</div></div>` : ''}
      <div class="btns"><button class="btn soft sm" data-act="syncnow"${sync.busy ? ' disabled' : ''}>${icon('cloud')}${sync.busy ? 'Синхронизация…' : 'Синхронизировать'}</button>
        <a class="btn sm" href="https://gist.github.com/${esc(cfg.gistId)}" target="_blank" rel="noopener">Открыть gist</a>
        <button class="btn sm" data-act="syncoff">Отключить здесь</button></div>
      <p class="small muted mt">Данные шифруются вашим паролем до отправки. Отключение удаляет с устройства токен и ключ, данные остаются.</p>`;
  }
  return `<div class="row-item" style="padding:0 0 10px"><span class="cat-ic c-accent">${icon('lock')}</span><div class="body"><div class="t">Телефон и компьютер вместе</div>
    <div class="s" style="white-space:normal">Данные шифруются на устройстве вашим паролем и хранятся в секретном gist на GitHub. Без пароля их не прочитать никому.</div></div></div>
  <ol class="steps">
    <li><span>Создайте токен: <a href="https://github.com/settings/tokens/new?scopes=gist&description=Kopilka%20sync" target="_blank" rel="noopener">открыть GitHub</a>. Право gist уже отмечено, срок можно поставить 1 год. Скопируйте токен (ghp_…).</span></li>
    <li><span>Придумайте пароль синхронизации, одинаковый на всех устройствах. Если его забыть, облачную копию не расшифровать.</span></li>
    <li><span>Подключите. На втором устройстве то же самое с тем же паролем.</span></li></ol>
  <form class="fields mt" data-form="syncconnect" autocomplete="off">
    <input class="input" type="password" name="token" required autocomplete="off" spellcheck="false" placeholder="Токен GitHub (ghp_…)" value="${esc(sync.tokenDraft)}" aria-label="Токен GitHub">
    <div class="fields two"><input class="input" type="password" name="pass" required minlength="8" autocomplete="new-password" placeholder="Пароль синхронизации" aria-label="Пароль синхронизации">
    <input class="input" type="password" name="pass2" required minlength="8" autocomplete="new-password" placeholder="Ещё раз" aria-label="Пароль ещё раз"></div>
    <button class="btn primary" type="submit"${sync.busy ? ' disabled' : ''}>${sync.busy ? 'Подключаю…' : 'Подключить'}</button>
  </form>${sync.error ? `<div class="notice bad mt">${icon('alert')}<div>${esc(sync.error)}</div></div>` : ''}`;
}
function planCalc() {
  const p = plan(state);
  const f = forecast(state);
  if (!p.income) return `<div class="notice">${icon('bulb')}<div>Укажите доход, и здесь появится план накоплений.</div></div>`;
  const months = p.savings > 0 ? Math.ceil(f.left / p.savings) : 0;
  return `<div class="notice ${p.savings > 0 ? 'good' : 'bad'}">${icon(p.savings > 0 ? 'coins' : 'alert')}<div>${p.savings > 0
    ? `<b>Откладывать ${money(p.savings)} в месяц.</b> ${f.left > 0 ? `Цель через ${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}.` : ''}<br><span class="small muted">${money(p.income)} − налог ${money(p.tax)} − аренда ${money(p.rent)} − лимиты ${money(p.limits)}</span>`
    : `Расходы по плану больше дохода на ${money(-p.savings)}. Уменьшите лимиты.`}</div></div>`;
}
function vSettings() {
  const s = state.settings;
  const nrow = (k, label) => `<label class="set-row"><span>${label}</span><input class="input" type="number" inputmode="numeric" min="0" step="1" data-setting="${k}" value="${Number(s[k]) || 0}"></label>`;
  return pageHead('Настройки') + `
  <section class="card"><div class="card-head"><h2>Доход и платежи</h2></div>
    ${nrow('income', 'Доход в месяц до налога')}
    <label class="set-row"><span>Налог НПД</span><select class="input" data-setting="taxRate"><option value="4"${s.taxRate == 4 ? ' selected' : ''}>4% · физлица</option><option value="6"${s.taxRate == 6 ? ' selected' : ''}>6% · компании</option></select></label>
    ${nrow('rent', 'Аренда в месяц')}
    <div id="plan-calc" class="mt">${planCalc()}</div></section>
  <section class="card"><div class="card-head"><h2>Цель</h2></div>
    <label class="set-row"><span>Название</span><input class="input" type="text" data-setting="goalName" value="${esc(s.goalName)}"></label>
    ${nrow('goalAmount', 'Сумма цели')}${nrow('cushion', 'Подушка сверх цели')}${nrow('initialSavings', 'Уже отложено до учёта')}</section>
  <section class="card"><div class="card-head"><h2>Лимиты на месяц</h2></div>
    ${LIMITED.map(id => `<label class="set-row"><span>${catIcon(id, 'sm')}${esc(CAT[id].name)}</span><input class="input" type="number" inputmode="numeric" min="0" step="100" data-limit="${id}" value="${Number(state.limits[id]) || 0}"></label>`).join('')}</section>
  <section class="card"><div class="card-head"><h2>Синхронизация</h2></div><div id="sync-box">${syncBox()}</div></section>
  <section class="card"><div class="card-head"><h2>Правила категорий</h2></div>
    <p class="small muted" style="margin-bottom:10px">Если в описании есть этот текст, операции ставится категория. Правила появляются сами, когда вы меняете категорию у операции.</p>
    ${state.rules.length ? `<div class="rows">${state.rules.map((r, i) => `<div class="row-item">${catIcon(r.cat, 'sm')}<div class="body fields two" style="gap:8px">
      <input class="input" type="text" value="${esc(r.match)}" data-rulematch="${i}" aria-label="Текст"><select class="input" data-rulecat="${i}" aria-label="Категория">${CATEGORIES.map(c => `<option value="${c.id}"${c.id === r.cat ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <button class="icon-btn" data-act="ruledel" data-i="${i}" aria-label="Удалить правило">${icon('trash')}</button></div>`).join('')}</div>` : ''}
    <form class="fields two mt" data-form="ruleadd" autocomplete="off"><input class="input" name="match" placeholder="Текст, например: петров" required>
      <select class="input" name="cat">${CATEGORIES.map(c => `<option value="${c.id}"${c.id === 'rent' ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="btn soft" type="submit">${icon('plus')}Добавить правило</button><button class="btn" type="button" data-act="recat">Применить к выпискам</button></form></section>
  <section class="card"><div class="card-head"><h2>Оформление</h2></div>
    <div class="seg" role="group">${[['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${s.theme === v}">${l}</button>`).join('')}</div></section>
  <section class="card"><div class="card-head"><h2>Как приложение на телефоне</h2></div>
    <ol class="steps"><li><span>Откройте эту страницу в Safari (на Android — в Chrome).</span></li><li><span>Нажмите «Поделиться», затем «На экран „Домой“». В Chrome — «Установить приложение».</span></li><li><span>Копилка будет открываться отдельным приложением, без адресной строки.</span></li></ol></section>
  <section class="card"><div class="card-head"><h2>Данные</h2></div>
    <p class="small muted" style="margin-bottom:12px">Копия в файле — на всякий случай или для переноса без синхронизации. Файл не зашифрован.</p>
    <div class="btns"><button class="btn sm" data-act="export">${icon('download')}Сохранить копию</button>
      <label class="btn sm"><input type="file" id="jsonfile" accept=".json,application/json" hidden>${icon('upload')}Загрузить копию</label>
      <button class="btn sm" data-act="exportcsv">${icon('file')}Операции в CSV</button></div>
    <button class="btn danger block mt" data-act="reset">${icon('trash')}Удалить все данные с этого устройства</button></section>`;
}

// ---------- Ещё ----------
function vMore() {
  return pageHead('Ещё', `<span class="sync-slot">${syncChip()}</span>`) + `<section class="card"><div class="rows">${SIDE.filter(id => R[id].more).map(id => `<a class="row-item" href="#${id}">
    <span class="cat-ic c-accent">${icon(R[id].ic)}</span><div class="body"><div class="t">${R[id].t}</div><div class="s">${R[id].d}</div></div>${icon('chevron')}</a>`).join('')}</div></section>
    <p class="small faint" style="text-align:center;margin-top:18px">Копилка · данные хранятся на ваших устройствах</p>`;
}

// ---------- отрисовка ----------
const VIEWS = { home: vHome, ops: vOps, habits: vHabits, basket: vBasket, food: vFood, import: vImport, settings: vSettings, more: vMore };

function renderNav(r) {
  const tabActive = R[r].more ? 'more' : r;
  document.getElementById('side').innerHTML = `<a class="brand" href="#home"><span class="logo">${icon('ruble')}</span>Копилка</a>
    <button class="btn primary add" data-act="add">${icon('plus')}Добавить</button>
    ${SIDE.map(id => `<a class="nav" href="#${id}"${id === r ? ' aria-current="page"' : ''}>${icon(R[id].ic)}${R[id].t}</a>`).join('')}
    <div class="sync-line sync-slot">${syncChip()}</div>`;
  const tab = id => `<a class="tab" href="#${id}"${id === tabActive ? ' aria-current="page"' : ''}>${icon(R[id].ic)}<span>${R[id].t}</span></a>`;
  document.getElementById('tabbar').innerHTML = `${tab('home')}${tab('ops')}<button class="tab-add" data-act="add" aria-label="Добавить операцию">${icon('plus')}</button>${tab('basket')}${tab('more')}`;
}

function render() {
  applyTheme();
  weekRollover();
  const r = route();
  renderNav(r);
  $app.innerHTML = `<div class="page">${storageOk ? '' : `<div class="notice bad" style="margin-top:16px">${icon('alert')}<div>Браузер не даёт сохранять данные (приватный режим?). Всё введённое пропадёт после закрытия.</div></div>`}${VIEWS[r]()}</div>`;
  document.title = r === 'home' ? 'Копилка' : `${R[r].t} · Копилка`;
  bindDrop();
}
function bindDrop() {
  const drop = document.getElementById('drop');
  if (!drop) return;
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readCSV(f); });
}

window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- события ----------
document.addEventListener('click', e => {
  if (e.target.matches('[data-overlay]')) { closeSheet(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'close': closeSheet(); break;
    case 'add': openTx(null); break;
    case 'quicksave': {
      const p = plan(state); const v = monthSummary(state, monthKey(today()));
      const need = Math.max(0, p.savings - v.saved);
      openTx(null, { group: 'piggy', cat: 'save', amount: need ? String(need) : '', note: 'Отложил в копилку' });
      break;
    }
    case 'edittx': { const t = state.tx.find(x => x.id === el.dataset.id); if (t) openTx(t); break; }
    case 'txgroup': readDraft(); draft.group = el.dataset.g; draft.cat = GROUPS[draft.group].cats.includes(draft.cat) ? draft.cat : GROUPS[draft.group].cats[0]; rerenderSheet(txSheet()); break;
    case 'txcat': readDraft(); draft.cat = el.dataset.c; rerenderSheet(txSheet()); break;
    case 'txsave': saveDraft(); break;
    case 'txdel':
      if (confirm('Удалить операцию?')) { state.tx = state.tx.filter(t => t.id !== draft.id); closeSheet(); commit('Операция удалена'); }
      break;
    case 'setup': openSetup(); break;
    case 'setuptax':
      el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
      el.closest('form').taxRate.value = el.dataset.v;
      break;
    case 'month': ui.month = addMonths(ui.month, Number(el.dataset.d)); render(); break;
    case 'opencat': ui.opsCat = el.dataset.cat; ui.opsMonth = route() === 'home' ? ui.month : ''; go('ops'); break;
    case 'opsmonth': ui.opsMonth = el.dataset.m; render(); break;
    case 'doimport': doImport(); break;
    case 'cancelimport': ui.imp = null; render(); break;
    case 'hmonths': ui.habitsMonths = Number(el.dataset.n); render(); break;
    case 'bedit': ui.basketEdit = !ui.basketEdit; render(); break;
    case 'bdel': state.basket.items = state.basket.items.filter(i => i.id !== el.dataset.id); commit(); break;
    case 'breset': state.basket.checked = {}; commit('Отметки сняты'); break;
    case 'bdefault': if (confirm('Вернуть список продуктов и цены по умолчанию?')) { state.basket.items = defaultState().basket.items; commit('Список восстановлен'); } break;
    case 'buy': openBuy(); break;
    case 'wdel': state.weights = state.weights.filter(w => w.date !== el.dataset.date); commit('Запись удалена'); break;
    case 'ruledel': state.rules.splice(Number(el.dataset.i), 1); commit('Правило удалено'); break;
    case 'recat': {
      let n = 0;
      for (const t of state.tx) {
        if (t.src !== 'import' || t.catManual || !t.raw) continue;
        const c = categorize({ desc: t.note, bankCat: t.raw.bankCat, mcc: t.raw.mcc, signedAmount: t.raw.signed }, state.rules);
        if (c.cat !== t.cat || c.amount !== t.amount) { t.cat = c.cat; t.amount = c.amount; n++; }
      }
      commit(n ? `Перераспределено: ${n}` : 'Изменений нет');
      break;
    }
    case 'theme': state.settings.theme = el.dataset.v; commit(); break;
    case 'export': download(`kopilka-${today()}.json`, JSON.stringify(state, null, 1), 'application/json'); break;
    case 'exportcsv': {
      const rows = [['Дата', 'Категория', 'Сумма', 'Описание']].concat(state.tx.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, CAT[t.cat]?.name || t.cat, String(t.amount).replace('.', ','), t.note || '']));
      download(`kopilka-operacii-${today()}.csv`, '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
      break;
    }
    case 'reset': {
      const synced = !!getConfig();
      if (confirm(`Удалить все операции, настройки и записи веса с этого устройства?${synced ? ' Синхронизация здесь отключится, зашифрованная копия в gist останется.' : ' Сначала стоит сохранить копию.'}`)) {
        (synced ? disconnect() : Promise.resolve()).then(() => {
          state = defaultState(); saveRaw(state); resetSnapshot(state); sync.error = ''; render(); toast('Данные удалены с этого устройства');
        });
      }
      break;
    }
    case 'syncnow': runSync(); break;
    case 'syncoff':
      if (confirm('Отключить синхронизацию на этом устройстве? Данные останутся и здесь, и в gist.')) disconnect().then(() => { sync.error = ''; render(); toast('Синхронизация отключена'); });
      break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  const d = el.dataset;
  if (d.filter === 'opsCat') { ui.opsCat = el.value; document.getElementById('ops-list').innerHTML = opsList(); }
  else if (d.setting) {
    const k = d.setting;
    if (el.type === 'number' || k === 'taxRate') state.settings[k] = Math.max(0, Number(el.value) || 0);
    else state.settings[k] = el.value;
    persist();
    const pc = document.getElementById('plan-calc'); if (pc) pc.innerHTML = planCalc();
  } else if (d.limit) {
    state.limits[d.limit] = Math.max(0, Number(el.value) || 0); persist();
    const pc = document.getElementById('plan-calc'); if (pc) pc.innerHTML = planCalc();
  } else if (d.bcheck) {
    if (el.checked) state.basket.checked[d.bcheck] = true; else delete state.basket.checked[d.bcheck];
    commit();
  } else if (d.bprice) {
    const it = state.basket.items.find(i => i.id === d.bprice);
    if (it) { it.price = Math.max(0, Number(el.value) || 0); commit(); }
  } else if (d.rulematch) {
    const v = el.value.trim().toLowerCase();
    if (v) { state.rules[Number(d.rulematch)].match = v; persist(); toast('Правило изменено'); }
  } else if (d.rulecat) { state.rules[Number(d.rulecat)].cat = el.value; commit('Правило изменено'); }
  else if (d.map && ui.imp) {
    if (d.map === 'hi') {
      const hi = Math.min(ui.imp.rows.length - 1, Math.max(0, Number(el.value) - 1));
      ui.imp.hi = hi; ui.imp.map = { ...detectColumns(ui.imp.rows[hi]), invert: ui.imp.map.invert };
    } else if (d.map === 'invert') ui.imp.map.invert = el.checked;
    else ui.imp.map[d.map] = Number(el.value);
    document.getElementById('imp-body').innerHTML = importBody();
  } else if (el.id === 'csvfile' && el.files[0]) readCSV(el.files[0]);
  else if (el.id === 'jsonfile' && el.files[0]) {
    el.files[0].text().then(t => {
      try {
        const data = JSON.parse(t);
        if (!data || !data.settings || !Array.isArray(data.tx)) throw new Error();
        if (!confirm(`Заменить текущие данные копией (${data.tx.length} операций)?`)) return;
        state = migrate(data); commit('Копия загружена');
      } catch { toast('Это не файл копии Копилки'); }
    });
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'tx-amount' || e.target.name === 'sum') e.target.style.width = amountWidth(e.target.value);
  if (e.target.dataset.filter === 'opsQuery') { ui.opsQuery = e.target.value; document.getElementById('ops-list').innerHTML = opsList(); }
});

document.addEventListener('submit', e => {
  const form = e.target;
  const f = form.dataset.form;
  if (!f) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  if (f === 'setup') {
    const s = state.settings;
    s.income = Math.max(0, Number(fd.income) || 0); s.taxRate = Number(fd.taxRate) || 6; s.rent = Math.max(0, Number(fd.rent) || 0);
    s.goalName = fd.goalName.trim() || s.goalName; s.goalAmount = Math.max(0, Number(fd.goalAmount) || 0); s.initialSavings = Math.max(0, Number(fd.initialSavings) || 0);
    closeSheet();
    const p = plan(state);
    commit(p.savings > 0 ? `Готово! План: откладывать ${money(p.savings)} в месяц` : 'Сохранено. Расходы больше дохода — поправьте лимиты в настройках');
  } else if (f === 'badd') {
    state.basket.items.push({ id: uid(), group: 'Добавлено', name: fd.name.trim(), qty: fd.qty.trim(), price: Number(fd.price) || 0 });
    commit('Добавлено в список');
  } else if (f === 'bbuy') {
    const sum = Number(String(fd.sum).replace(/\s/g, '').replace(',', '.'));
    if (!sum) return;
    const date = fd.date || today();
    state.tx.push({ id: uid(), date, cat: 'food', amount: sum, note: 'Продукты по корзине', src: 'manual', ts: Date.now(), catManual: true });
    const week = isoWeek(date);
    const prev = state.basket.history.find(x => x.week === week);
    if (prev) { prev.actual += sum; prev.planned = basketTotal(); } else state.basket.history.push({ week, planned: basketTotal(), actual: sum });
    closeSheet(); commit(`Записано: продукты ${money(sum)}`);
  } else if (f === 'weight') {
    const kg = Number(String(fd.kg).replace(',', '.'));
    if (!kg || kg < 30 || kg > 250) { toast('Введите вес в килограммах'); return; }
    const date = today();
    state.weights = state.weights.filter(w => w.date !== date).concat({ date, kg });
    commit('Вес записан');
  } else if (f === 'ruleadd') {
    const m = fd.match.trim().toLowerCase();
    if (!m) return;
    state.rules = state.rules.filter(r => r.match !== m);
    state.rules.unshift({ match: m, cat: fd.cat });
    commit('Правило добавлено');
  } else if (f === 'syncconnect') {
    if (fd.pass !== fd.pass2) { sync.error = 'Пароли не совпадают.'; sync.tokenDraft = fd.token; showSync(); return; }
    if (fd.pass.length < 8) { sync.error = 'Пароль должен быть не короче 8 символов.'; sync.tokenDraft = fd.token; showSync(); return; }
    sync.error = ''; sync.busy = true; sync.tokenDraft = fd.token;
    document.activeElement?.blur(); showSync();
    connect(fd.token, fd.pass, state).then(r => {
      sync.busy = false; sync.tokenDraft = '';
      applyRemote(r.state); render();
      toast(r.created ? 'Синхронизация включена' : 'Подключено: данные объединены');
    }).catch(err => {
      sync.busy = false;
      sync.error = err instanceof SyncError ? err.message : 'Не удалось подключиться.';
      console.error(err); showSync();
    });
  }
});

render();
if (getConfig()) runSync();

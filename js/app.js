import { CATEGORIES, CAT, NUTRITION } from './data.js';
import {
  load, save, migrate, defaultState, storageOk, today, monthKey, addMonths, monthName, fmtDate,
  isoWeek, uid, money, num, esc,
} from './store.js';
import { decodeBytes, parseCSV, findHeaderRow, detectColumns, rowsToOperations, opHash } from './csv.js';
import { categorize, merchantKey } from './categorize.js';
import {
  plan, limitFor, monthSummary, savingsBalance, verdict, history, streak, forecast, habits, weightTrend, LIMITED, WD,
} from './analytics.js';

let state = load();
const ui = {
  month: monthKey(today()),
  opsMonth: monthKey(today()),
  opsCat: '',
  opsQuery: '',
  habitsMonths: 3,
  lastCat: 'food',
  imp: null,
};

const ROUTES = [
  ['overview', 'Обзор'],
  ['ops', 'Операции'],
  ['import', 'Импорт выписки'],
  ['habits', 'Привычки'],
  ['basket', 'Корзина'],
  ['food', 'Питание и вес'],
  ['settings', 'Настройки'],
];
const $app = document.getElementById('app');
const route = () => {
  const r = location.hash.slice(1);
  return ROUTES.some(x => x[0] === r) ? r : 'overview';
};

// ---------- общее ----------
function commit(msg) { save(state); render(); if (msg) toast(msg); }
function persist() { save(state); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
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

const kind = id => (CAT[id] || CAT.other).kind;
const basketTotal = () => state.basket.items.reduce((a, i) => a + (Number(i.price) || 0), 0);

function catOptions(selected) {
  const groups = [
    ['Поступления', c => c.kind === 'income'],
    ['Траты', c => c.kind === 'expense'],
    ['Накопления', c => c.kind === 'save' || c.kind === 'unsave'],
    ['Не учитывать', c => c.kind === 'internal'],
  ];
  return groups.map(([label, f]) =>
    `<optgroup label="${label}">${CATEGORIES.filter(f).map(c =>
      `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}

function signedView(t) {
  const k = kind(t.cat);
  if (k === 'income') return `<span class="good">+${num(t.amount)}</span>`;
  if (k === 'save') return `<span>${num(t.amount)} в копилку</span>`;
  if (k === 'unsave') return `<span>${num(t.amount)} из копилки</span>`;
  if (k === 'internal') return `<span class="muted">${num(t.amount)}</span>`;
  return t.amount < 0 ? `<span class="good">+${num(-t.amount)}</span>` : `−${num(t.amount)}`;
}

function barRow(name, spent, limit, note = '') {
  let inner, val, cls = '';
  if (limit > 0) {
    const scale = Math.max(limit, spent);
    const base = (Math.min(spent, limit) / scale) * 100;
    const over = spent > limit ? ((spent - limit) / scale) * 100 : 0;
    inner = `<span style="width:${base}%"></span>` +
      (over ? `<span class="over" style="left:${base}%;width:${over}%"></span><i class="marker" style="left:calc(${base}% - 1px)"></i>` : '');
    val = `${num(spent)} из ${num(limit)} ₽`;
    if (spent > limit) { val += ` · превышение ${num(spent - limit)}`; cls = 'bad'; }
  } else {
    inner = spent > 0 ? `<span style="width:100%;opacity:.45"></span>` : '';
    val = `${num(spent)} ₽ · вне плана`;
  }
  const title = `${name}: ${val}${note ? '. ' + note : ''}`;
  return `<div class="name" title="${esc(title)}">${esc(name)}</div>
    <div class="bar" title="${esc(title)}">${inner}</div>
    <div class="val num ${cls}">${val}</div>`;
}

function columns(items, { ref = null, h = 160 } = {}) {
  const max = Math.max(1, ref || 0, ...items.map(i => i.value));
  const pct = v => (Math.max(0, v) / max) * 100;
  return `<div class="cols" style="--h:${h}px">
    ${items.map(i => `<div class="c" title="${esc(i.title)}"><div class="v ${i.cls || ''}" style="height:${pct(i.value)}%"></div><div class="top" style="bottom:${pct(i.value)}%">${esc(i.top ?? '')}</div></div>`).join('')}
    ${ref ? `<div class="ref" style="bottom:calc((100% - 18px) * ${pct(ref) / 100})"><span>план ${num(ref)}</span></div>` : ''}
  </div>
  <div class="cols-labels">${items.map(i => `<span>${esc(i.label)}</span>`).join('')}</div>`;
}

function addForm(id) {
  return `<form class="row" id="${id}" data-form="add" autocomplete="off">
    <input type="date" name="date" value="${today()}" required aria-label="Дата">
    <input type="number" name="amount" step="0.01" placeholder="Сумма, ₽" required inputmode="decimal" style="width:130px" aria-label="Сумма">
    <select name="cat" aria-label="Категория">${catOptions(ui.lastCat)}</select>
    <input type="text" name="note" class="grow" placeholder="Комментарий (необязательно)" aria-label="Комментарий">
    <button class="primary" type="submit">Добавить</button>
  </form>`;
}

// ---------- Обзор ----------
function vOverview() {
  const s = state.settings;
  const p = plan(state);
  const mk = ui.month;
  const v = verdict(state, mk);
  const f = forecast(state);
  const cur = monthKey(today());
  let h = '';
  if (!s.income) {
    h += `<div class="callout">Сначала заполните <a href="#settings">настройки</a>: доход, налог и аренду. По ним считаются план накоплений и лимиты.</div>`;
  }
  h += `<h1>${esc(s.goalName || 'Цель')}</h1>
  <div class="figures">
    <div class="figure"><div class="label">Накоплено</div><div class="value">${money(f.balance)}</div><div class="sub">из ${money(f.target)}</div></div>
    <div class="figure"><div class="label">Осталось</div><div class="value">${money(f.left)}</div><div class="sub">${f.pct.toFixed(0)}% пути</div></div>
    <div class="figure"><div class="label">Прогноз</div><div class="value">${f.left === 0 ? 'Цель достигнута' : f.months != null ? monthName(f.doneMonth) : '—'}</div>
      <div class="sub">${f.left === 0 ? '' : f.pace > 0 ? `при ${money(f.pace)} в месяц (${f.paceSource === 'факт' ? 'по факту последних месяцев' : 'по плану'})` : 'нет плана накоплений'}</div></div>
  </div>
  <div class="bar big" title="${esc(`${money(f.balance)} из ${money(f.target)}`)}"><span style="width:${f.pct}%"></span></div>`;

  h += `<h2>${monthName(mk)}</h2>
  <div class="row">
    <button data-act="month" data-d="-1" aria-label="Предыдущий месяц">←</button>
    <button data-act="month" data-d="1" aria-label="Следующий месяц"${mk >= cur ? ' disabled' : ''}>→</button>
    ${mk !== cur ? '<button data-act="month" data-d="0">Текущий месяц</button>' : ''}
  </div>
  <div class="figures">
    <div class="figure"><div class="label">Доход</div><div class="value">${money(v.income)}</div><div class="sub">план ${money(p.income)}</div></div>
    <div class="figure"><div class="label">Траты</div><div class="value">${money(v.spent)}</div><div class="sub">план ${money(p.spend)} с налогом и арендой</div></div>
    <div class="figure"><div class="label">Отложено</div><div class="value">${money(v.saved)}</div><div class="sub">план ${money(p.savings)}</div></div>
    <div class="figure"><div class="label">Не распределено</div><div class="value">${money(v.left)}</div><div class="sub">доход − траты − отложено</div></div>
  </div>
  <p>${v.met ? '<span class="status good">План накоплений выполнен</span>'
      : p.savings > 0 ? `<span class="status ${mk < cur ? 'bad' : 'neutral'}">До плана накоплений ${money(p.savings - v.saved)}</span>` : ''}</p>
  <h3>Добавить операцию</h3>
  ${addForm('quick')}
  <h3>Траты по категориям</h3>
  <div class="bars">${['tax', 'rent', ...LIMITED.filter(id => id !== 'tax' && id !== 'rent')]
      .concat(Object.keys(v.byCat).filter(id => !LIMITED.includes(id) && id !== 'tax' && id !== 'rent'))
      .filter(id => (v.byCat[id] || 0) > 0 || limitFor(state, id) > 0)
      .map(id => barRow(CAT[id].name, v.byCat[id] || 0, limitFor(state, id))).join('')}</div>`;

  const hist = history(state).slice(-12);
  h += `<h2>Отложено по месяцам</h2>
  ${columns(hist.map(x => ({
    label: monthName(x.month, true),
    value: x.saved,
    top: x.saved ? num(x.saved) : '',
    cls: x.month < cur && !x.met ? 'low' : '',
    title: `${monthName(x.month)}: отложено ${money(x.saved)}, план ${money(x.plan)}`,
  })), { ref: p.savings > 0 ? p.savings : null })}
  <div class="table-wrap"><table>
    <thead><tr><th>Месяц</th><th class="r">Доход</th><th class="r">Траты</th><th class="r">Отложено</th><th>Итог</th></tr></thead>
    <tbody>${hist.slice().reverse().map(x => `<tr${x.count ? '' : ' class="dim"'}>
      <td>${monthName(x.month)}</td><td class="r num">${num(x.income)}</td><td class="r num">${num(x.spent)}</td><td class="r num">${num(x.saved)}</td>
      <td>${x.month === cur ? '<span class="status neutral">идёт</span>' : !x.count ? '<span class="muted">нет данных</span>' : x.met ? '<span class="status good">выполнен</span>' : '<span class="status bad">не выполнен</span>'}</td></tr>`).join('')}</tbody>
  </table></div>`;

  h += `<h2>Успехи и провалы</h2><ul class="plain">${achievements().map(a => `<li><span class="status ${a[0]}">${esc(a[1])}</span>${a[2] ? ` <span class="muted">${esc(a[2])}</span>` : ''}</li>`).join('')}</ul>`;
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
  if (f.left === 0 && f.target > 0) out.push(['good', 'Цель накоплена', 'можно покупать']);
  if (done.length) {
    out.push([met === done.length ? 'good' : met ? 'neutral' : 'bad', `План накоплений выполнен в ${met} из ${done.length} месяцев`, st ? `серия подряд: ${st}` : '']);
  }
  const v = verdict(state, cur);
  if (p.savings > 0) {
    out.push(v.met ? ['good', 'В этом месяце план уже выполнен', '']
      : ['neutral', `В этом месяце осталось отложить ${money(p.savings - v.saved)}`, '']);
  }
  if (v.count) {
    out.push(v.over.length
      ? ['bad', `Превышены лимиты: ${v.over.map(o => CAT[o.id].name.toLowerCase()).join(', ')}`, `на ${money(v.over.reduce((a, o) => a + o.spent - o.limit, 0))}`]
      : ['good', 'Все лимиты этого месяца соблюдены', '']);
  }
  const bh = state.basket.history;
  if (bh.length) {
    const ok = bh.filter(b => b.actual <= b.planned * 1.05).length;
    out.push([ok === bh.length ? 'good' : 'neutral', `Корзина уложилась в план: ${ok} из ${bh.length} недель`, 'допуск 5%']);
  }
  const wt = weightTrend(state.weights);
  if (wt) out.push([wt.perWeek >= 0.25 && wt.perWeek <= 0.5 ? 'good' : 'neutral', `Вес: ${wt.perWeek >= 0 ? '+' : ''}${wt.perWeek.toFixed(2).replace('.', ',')} кг в неделю`, wt.advice]);
  if (!out.length) out.push(['neutral', 'Пока нечего оценивать', 'добавьте операции вручную или импортируйте выписку']);
  return out;
}

// ---------- Операции ----------
function vOps() {
  const months = [...new Set([...state.tx.map(t => monthKey(t.date)), monthKey(today())])].sort().reverse();
  return `<h1>Операции</h1>
  <p class="muted small">Если загружаете выписки из банка, вручную добавляйте только наличные, иначе операции задвоятся.</p>
  ${addForm('add-ops')}
  <div class="spacer"></div>
  <div class="row">
    <select data-filter="opsMonth" aria-label="Месяц"><option value="">Все месяцы</option>${months.map(m => `<option value="${m}"${m === ui.opsMonth ? ' selected' : ''}>${monthName(m)}</option>`).join('')}</select>
    <select data-filter="opsCat" aria-label="Категория"><option value="">Все категории</option>${catOptions(ui.opsCat)}</select>
    <input type="search" class="grow" data-filter="opsQuery" value="${esc(ui.opsQuery)}" placeholder="Поиск по описанию">
  </div>
  <label class="check small" style="margin-top:10px"><input type="checkbox" data-setting="rememberRules"${state.settings.rememberRules ? ' checked' : ''}>
    При смене категории запоминать правило для этого места</label>
  <div id="ops-list">${opsList()}</div>`;
}

function opsList() {
  const q = ui.opsQuery.trim().toLowerCase();
  const list = state.tx
    .filter(t => (!ui.opsMonth || monthKey(t.date) === ui.opsMonth) && (!ui.opsCat || t.cat === ui.opsCat) && (!q || (t.note || '').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));
  if (!list.length) return '<p class="muted" style="margin-top:16px">Операций нет.</p>';
  let inc = 0, exp = 0;
  for (const t of list) { const k = kind(t.cat); if (k === 'income') inc += t.amount; else if (k === 'expense') exp += t.amount; }
  let h = `<p class="small muted" style="margin-top:14px">${list.length} операций · поступления ${money(inc)} · траты ${money(exp)}</p><ul class="ops">`;
  let day = '';
  for (const t of list.slice(0, 600)) {
    if (t.date !== day) { day = t.date; h += `<li class="day">${fmtDate(day)}</li>`; }
    h += `<li class="op"><span class="desc" title="${esc(t.note)}">${esc(t.note || CAT[t.cat]?.name || '')}</span>
      <select data-txcat="${t.id}" aria-label="Категория">${catOptions(t.cat)}</select>
      <span class="amt">${signedView(t)}</span>
      <button class="link" data-act="deltx" data-id="${t.id}" title="Удалить" aria-label="Удалить">✕</button></li>`;
  }
  if (list.length > 600) h += `<li class="day">Показаны первые 600. Уточните фильтр.</li>`;
  return h + '</ul>';
}

function setTxCat(id, cat) {
  const t = state.tx.find(x => x.id === id);
  if (!t) return;
  const oldKind = kind(t.cat);
  t.cat = cat; t.catManual = true;
  if (kind(cat) === 'expense' && oldKind !== 'expense' && t.raw && t.raw.signed > 0) t.amount = -Math.abs(t.amount);
  if (kind(cat) !== 'expense' && t.amount < 0) t.amount = Math.abs(t.amount);
  let msg = `Категория: ${CAT[cat].name}`;
  if (state.settings.rememberRules && t.note) {
    const key = merchantKey(t.note);
    if (key) {
      state.rules = state.rules.filter(r => r.match !== key);
      state.rules.unshift({ match: key, cat });
      let n = 0;
      for (const o of state.tx) {
        if (o.id !== t.id && !o.catManual && o.note && merchantKey(o.note) === key && kind(o.cat) === oldKind && o.cat !== cat) {
          o.cat = cat; n++;
        }
      }
      msg = `Правило «${key}» → ${CAT[cat].name}${n ? `, обновлено ещё ${n}` : ''}`;
    }
  }
  persist();
  if (route() === 'ops') document.getElementById('ops-list').innerHTML = opsList();
  toast(msg);
}

// ---------- Импорт ----------
function vImport() {
  let h = `<h1>Импорт выписки</h1>
  <p>Файл читается прямо в браузере и никуда не отправляется. Подходит CSV из любого банка: столбцы определяются автоматически, их можно поправить вручную.</p>
  <details><summary>Где взять CSV</summary>
    <ul>
      <li>Откройте интернет-банк в браузере на компьютере (в мобильных приложениях выгрузка в CSV есть не везде), раздел операций или выписок.</li>
      <li>Выберите период и формат CSV. Если банк даёт только Excel, откройте файл в Numbers или Excel и сохраните как CSV.</li>
      <li>Если банк даёт только PDF, такой файл приложение не читает. Тогда операции придётся вносить вручную или выгрузить выписку в другом формате через поддержку банка.</li>
      <li>Повторно загружать пересекающиеся периоды можно: уже добавленные операции пропускаются.</li>
    </ul>
  </details>
  <div class="drop" id="drop">
    <p>Перетащите файл сюда или</p>
    <label class="btn"><input type="file" id="csvfile" accept=".csv,.txt,text/csv" hidden>Выбрать файл</label>
  </div>`;
  if (ui.imp) h += `<div id="imp-body">${importBody()}</div>`;
  return h;
}

const FIELDS = [
  ['date', 'Дата', true], ['amount', 'Сумма (или «Расход»)', true], ['income', 'Приход (если отдельный столбец)', false],
  ['desc', 'Описание', false], ['bankCat', 'Категория банка', false], ['mcc', 'MCC', false], ['status', 'Статус', false],
];

function importPreview() {
  const { rows, hi, map } = ui.imp;
  const { ops, errors } = rowsToOperations(rows, hi, map);
  const have = new Set(state.tx.map(t => t.hash).filter(Boolean));
  const items = ops.map(op => {
    const hash = opHash(op);
    return { op, hash, dup: have.has(hash), ...categorize(op, state.rules) };
  });
  return { items, errors };
}

function importBody() {
  const { rows, hi, map, name } = ui.imp;
  const header = rows[hi] || [];
  const { items, errors } = importPreview();
  const fresh = items.filter(i => !i.dup);
  const dates = items.map(i => i.op.date).sort();
  let h = `<h2>${esc(name)}</h2>
  <p class="muted small">Строка заголовка: ${hi + 1}. Найдено операций: ${items.length}${dates.length ? `, с ${fmtDate(dates[0])} по ${fmtDate(dates[dates.length - 1])}` : ''}. Новых: ${fresh.length}, уже есть: ${items.length - fresh.length}${errors.length ? `, не разобрано строк: ${errors.length}` : ''}.</p>
  <div class="grid-form">${FIELDS.map(([k, label]) => `<label class="field">${label}
    <select data-map="${k}"><option value="-1">— нет —</option>${header.map((c, i) => `<option value="${i}"${map[k] === i ? ' selected' : ''}>${esc(c || `столбец ${i + 1}`)}</option>`).join('')}</select></label>`).join('')}
    <label class="field">Строка заголовка<input type="number" min="1" max="${rows.length}" value="${hi + 1}" data-map="hi"></label>
  </div>
  <label class="check" style="margin-top:10px"><input type="checkbox" data-map="invert"${map.invert ? ' checked' : ''}> Траты в файле записаны положительными числами</label>`;
  if (!items.length) return h + `<p class="callout bad">Не удалось разобрать операции. Проверьте, какие столбцы выбраны для даты и суммы.</p>`;
  h += `<div class="row" style="margin:14px 0"><button class="primary" data-act="doimport"${fresh.length ? '' : ' disabled'}>Добавить ${fresh.length} операций</button>
    <button data-act="cancelimport">Отмена</button></div>
  <div class="table-wrap"><table><thead><tr><th>Дата</th><th>Описание</th><th class="r">Сумма</th><th>Категория</th><th></th></tr></thead><tbody>
  ${items.slice(0, 40).map(i => `<tr${i.dup ? ' class="dim"' : ''}><td class="num">${fmtDate(i.op.date)}</td><td>${esc(i.op.desc)}</td>
    <td class="r num">${i.op.signedAmount > 0 ? '+' : '−'}${num(Math.abs(i.op.signedAmount))}</td><td>${esc(CAT[i.cat].name)}</td><td class="small">${i.dup ? 'уже есть' : ''}</td></tr>`).join('')}
  </tbody></table></div>
  ${items.length > 40 ? `<p class="muted small">Показаны первые 40 из ${items.length}. Категории можно поправить после импорта в «Операциях».</p>` : ''}`;
  return h;
}

async function readCSV(file) {
  if (/\.(xlsx?|pdf)$/i.test(file.name)) { toast('Нужен CSV. Excel сохраните как CSV, PDF не поддерживается.'); return; }
  const text = decodeBytes(await file.arrayBuffer());
  const rows = parseCSV(text);
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
    state.tx.push({
      id: uid(), date: i.op.date, cat: i.cat, amount: i.amount, note: i.op.desc, src: 'import', hash: i.hash, ts: ts + n,
      raw: { signed: i.op.signedAmount, bankCat: i.op.bankCat, mcc: i.op.mcc },
    });
    n++;
  }
  ui.imp = null;
  ui.opsMonth = '';
  location.hash = '#ops';
  commit(`Добавлено операций: ${n}`);
}

// ---------- Привычки ----------
function vHabits() {
  const hb = habits(state, ui.habitsMonths, basketTotal());
  let h = `<h1>Привычки в тратах</h1>
  <div class="row"><span class="muted">Период:</span>${[1, 3, 6, 12].map(n => `<button data-act="hmonths" data-n="${n}"${n === ui.habitsMonths ? ' class="primary"' : ''}>${n === 1 ? 'этот месяц' : `${n} мес.`}</button>`).join('')}</div>`;
  if (!hb.catAvg.length) return h + `<p class="callout">Пока нет трат за этот период. Загрузите выписку в разделе <a href="#import">«Импорт выписки»</a> или добавьте операции вручную.</p>`;
  if (hb.insights.length) h += `<h2>Выводы</h2><ul>${hb.insights.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;

  const maxAvg = Math.max(...hb.catAvg.map(c => Math.max(c.avg, c.limit)));
  h += `<h2>Средние траты в месяц</h2><p class="muted small">Риска на полосе — лимит категории.</p><div class="bars">${hb.catAvg.map(c => {
    const over = c.limit > 0 && c.avg > c.limit;
    const t = `${CAT[c.cat].name}: в среднем ${money(c.avg)} в месяц${c.limit ? `, лимит ${money(c.limit)}` : ''}`;
    return `<div class="name" title="${esc(t)}">${esc(CAT[c.cat].name)}</div>
      <div class="bar" title="${esc(t)}"><span class="${over ? 'over' : ''}" style="width:${(c.avg / maxAvg) * 100}%"></span>${c.limit ? `<i class="marker" style="left:calc(${(c.limit / maxAvg) * 100}% - 1px)"></i>` : ''}</div>
      <div class="val num${over ? ' bad' : ''}">${num(c.avg)} ₽</div>`;
  }).join('')}</div>`;

  h += `<h2>По дням недели</h2><p class="muted small">Без аренды, налога и переводов людям, сумма за период.</p>
  ${columns(hb.wd.map((w, i) => ({ label: WD[i], value: w.sum, top: w.sum ? num(w.sum) : '', title: `${WD[i]}: ${money(w.sum)}, ${w.count} покупок` })), { h: 140 })}`;

  h += `<h2>Где тратится больше всего</h2><div class="table-wrap"><table><thead><tr><th>Место</th><th>Категория</th><th class="r">Раз</th><th class="r">Сумма</th></tr></thead><tbody>
  ${hb.top.map(m => `<tr><td>${esc(m.key)}</td><td>${esc(CAT[m.cat]?.name || '')}</td><td class="r num">${m.count}</td><td class="r num">${num(m.sum)}</td></tr>`).join('')}
  </tbody></table></div>`;

  if (hb.subs.length) {
    h += `<h2>Похоже на регулярные платежи</h2><div class="table-wrap"><table><thead><tr><th>Место</th><th class="r">В месяц</th></tr></thead><tbody>
    ${hb.subs.map(s => `<tr><td>${esc(s.key)}</td><td class="r num">${num(s.monthly)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const cur = monthKey(today());
  h += `<h2>Этот месяц и прошлый</h2>
  <p class="muted small">Текущий месяц идёт: прошло ${hb.elapsed} дн.</p>
  <div class="table-wrap"><table><thead><tr><th>Категория</th><th class="r">Прошлый</th><th class="r">Этот</th><th class="r">Разница</th></tr></thead><tbody>
  ${hb.deltas.map(d => {
    const diff = d.now - d.prev;
    return `<tr><td>${esc(CAT[d.cat]?.name || d.cat)}</td><td class="r num">${num(d.prev)}</td><td class="r num">${num(d.now)}</td>
      <td class="r num ${diff > 0 ? 'bad' : diff < 0 ? 'good' : ''}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${num(Math.abs(diff))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  return h;
}

// ---------- Корзина ----------
function vBasket() {
  const b = state.basket;
  const total = basketTotal();
  const checkedSum = b.items.filter(i => b.checked[i.id]).reduce((a, i) => a + (Number(i.price) || 0), 0);
  const done = b.items.filter(i => b.checked[i.id]).length;
  const food = monthSummary(state, monthKey(today())).byCat.food || 0;
  const foodLimit = limitFor(state, 'food');
  let h = `<h1>Корзина на неделю</h1>
  <p class="muted">Неделя ${b.week.slice(-2)}. Отметки сбрасываются каждый понедельник.</p>
  <div class="figures">
    <div class="figure"><div class="label">По плану</div><div class="value">${money(total)}</div><div class="sub">${b.items.length} позиций</div></div>
    <div class="figure"><div class="label">Отмечено</div><div class="value">${money(checkedSum)}</div><div class="sub">${done} из ${b.items.length}</div></div>
    <div class="figure"><div class="label">Продукты в этом месяце</div><div class="value">${money(food)}</div><div class="sub">лимит ${money(foodLimit)}, осталось ${money(Math.max(0, foodLimit - food))}</div></div>
  </div>
  <ul class="basket">`;
  let g = '';
  for (const i of b.items) {
    if (i.group !== g) { g = i.group; h += `<li class="group">${esc(g || 'Прочее')}</li>`; }
    h += `<li class="${b.checked[i.id] ? 'done' : ''}">
      <input type="checkbox" id="b-${esc(i.id)}" data-bcheck="${i.id}"${b.checked[i.id] ? ' checked' : ''}>
      <label class="bname" for="b-${esc(i.id)}">${esc(i.name)}</label>
      <span class="qty">${esc(i.qty)}</span>
      <input type="number" min="0" step="1" value="${Number(i.price) || 0}" data-bprice="${i.id}" aria-label="Цена ${esc(i.name)}, ₽">
      <button class="link" data-act="bdel" data-id="${i.id}" title="Убрать из списка" aria-label="Убрать">✕</button></li>`;
  }
  h += `</ul>
  <h3>Добавить продукт</h3>
  <form class="row" data-form="badd" autocomplete="off">
    <input type="text" name="name" class="grow" placeholder="Название" required>
    <input type="text" name="qty" placeholder="Кол-во" style="width:110px">
    <input type="number" name="price" placeholder="₽" style="width:90px" min="0">
    <button type="submit">Добавить</button>
  </form>
  <h2>Записать покупку</h2>
  <p class="muted small">Сумма чека попадёт в траты «Продукты», а неделя — в статистику корзины.</p>
  <form class="row" data-form="bbuy">
    <input type="number" name="sum" value="${Math.round(checkedSum || total)}" min="1" required style="width:140px" aria-label="Сумма чека">
    <input type="date" name="date" value="${today()}" aria-label="Дата">
    <button class="primary" type="submit">Записать</button>
  </form>
  <div class="row" style="margin-top:18px"><button data-act="breset">Снять все отметки</button><button data-act="bdefault">Вернуть список по умолчанию</button></div>`;
  if (b.history.length) {
    h += `<h2>Прошлые недели</h2><div class="table-wrap"><table><thead><tr><th>Неделя</th><th class="r">План</th><th class="r">Чек</th><th class="r">Разница</th></tr></thead><tbody>
    ${b.history.slice().reverse().slice(0, 12).map(x => `<tr><td>${esc(x.week.slice(0, 4))}, неделя ${Number(x.week.slice(-2))}</td><td class="r num">${num(x.planned)}</td><td class="r num">${num(x.actual)}</td>
      <td class="r num ${x.actual > x.planned ? 'bad' : 'good'}">${x.actual > x.planned ? '+' : '−'}${num(Math.abs(x.actual - x.planned))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return h;
}

// ---------- Питание и вес ----------
function vFood() {
  const N = NUTRITION;
  let h = `<h1>Питание и вес</h1><p>${esc(N.targets)}</p>
  <h2>Рацион на день</h2><div class="table-wrap"><table><thead><tr><th>Приём</th><th>Что</th><th class="r">ккал</th><th class="r">белок, г</th></tr></thead><tbody>
  ${N.day.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="r num">${r[2]}</td><td class="r num">${r[3]}</td></tr>`).join('')}
  <tr><td><b>Итого</b></td><td></td><td class="r num"><b>~2 900</b></td><td class="r num"><b>~160</b></td></tr></tbody></table></div>
  <h2>Заготовки на воскресенье</h2><p class="muted">Около 2–2,5 часов: 7 обедов и 7 ужинов.</p>
  <ol>${N.prep.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
  <h2>Рецепты</h2>
  ${N.recipes.map(r => `<details><summary>${esc(r.title)}</summary>${r.ingredients ? `<p class="muted">${esc(r.ingredients)}</p>` : ''}<ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>`).join('')}
  <h2>Хранение</h2><ul>${N.storage.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;

  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const wt = weightTrend(w);
  h += `<h2>Вес</h2>
  <p class="muted small">Взвешивайтесь утром натощак 2–3 раза в неделю. Темп считается за последние три недели.</p>
  <form class="row" data-form="weight">
    <input type="date" name="date" value="${today()}" aria-label="Дата">
    <input type="number" name="kg" step="0.1" min="30" max="200" placeholder="кг" required style="width:100px" inputmode="decimal" aria-label="Вес, кг">
    <button class="primary" type="submit">Записать</button>
  </form>
  ${wt ? `<p style="margin-top:12px"><b>${wt.perWeek >= 0 ? '+' : ''}${wt.perWeek.toFixed(2).replace('.', ',')} кг в неделю.</b> ${esc(wt.advice)}</p>`
      : w.length ? '<p class="muted" style="margin-top:12px">Для оценки темпа нужно хотя бы 3 записи за неделю и больше.</p>' : ''}
  ${w.length >= 2 ? lineChart(w.slice(-60)) : ''}
  ${w.length ? `<div class="table-wrap"><table><tbody>${w.slice().reverse().slice(0, 10).map(x => `<tr><td>${fmtDate(x.date)}</td><td class="r num">${String(x.kg).replace('.', ',')} кг</td>
    <td class="r"><button class="link" data-act="wdel" data-date="${x.date}" aria-label="Удалить">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  return h;
}

function lineChart(points) {
  const ys = points.map(p => p.kg);
  const min = Math.min(...ys) - 0.3, max = Math.max(...ys) + 0.3;
  const n = points.length;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * 100).toFixed(2)},${(((max - p.kg) / (max - min)) * 100).toFixed(2)}`).join('');
  const f = v => v.toFixed(1).replace('.', ',');
  return `<div class="line-chart" title="Вес: от ${f(Math.min(...ys))} до ${f(Math.max(...ys))} кг">
    <span class="ymax">${f(max)}</span><span class="ymin">${f(min)}</span>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="График веса"><path d="${d}"/></svg></div>
    <div class="line-axis"><span>${fmtDate(points[0].date)}</span><span>${fmtDate(points[n - 1].date)}</span></div>`;
}

// ---------- Настройки ----------
function vSettings() {
  const s = state.settings;
  const nf = (k, label, extra = '') => `<label class="field">${label}<input type="number" data-setting="${k}" value="${Number(s[k]) || 0}" min="0" step="1" inputmode="numeric" ${extra}></label>`;
  return `<h1>Настройки</h1>
  ${!s.income ? '<p class="callout">Заполните доход, налог и аренду. Данные хранятся только в этом браузере.</p>' : ''}
  <h2>Доход и обязательные платежи</h2>
  <div class="grid-form">
    ${nf('income', 'Доход в месяц до налога, ₽')}
    <label class="field">Ставка налога НПД<select data-setting="taxRate">
      <option value="4"${s.taxRate == 4 ? ' selected' : ''}>4% — клиенты физлица</option>
      <option value="6"${s.taxRate == 6 ? ' selected' : ''}>6% — клиенты юрлица и ИП</option></select></label>
    ${nf('rent', 'Аренда, ₽ в месяц')}
  </div>
  <h2>Цель</h2>
  <div class="grid-form">
    <label class="field">Название<input type="text" data-setting="goalName" value="${esc(s.goalName)}"></label>
    ${nf('goalAmount', 'Сумма цели, ₽')}
    ${nf('cushion', 'Подушка сверх цели, ₽')}
    ${nf('initialSavings', 'Уже отложено до начала учёта, ₽')}
  </div>
  <h2>Лимиты трат в месяц</h2>
  <div class="grid-form">${LIMITED.map(id => `<label class="field">${esc(CAT[id].name)}<input type="number" min="0" step="100" data-limit="${id}" value="${Number(state.limits[id]) || 0}" inputmode="numeric"></label>`).join('')}</div>
  <div id="plan-calc">${planCalc()}</div>

  <h2>Правила категорий</h2>
  <p class="muted small">Если описание операции содержит текст правила, ей ставится эта категория. Правила создаются, когда вы меняете категорию в «Операциях». Встроенные правила (магазины, MCC, категории банка) работают после ваших.</p>
  ${state.rules.length ? `<div class="table-wrap"><table><thead><tr><th>Текст в описании</th><th>Категория</th><th></th></tr></thead><tbody>
    ${state.rules.map((r, i) => `<tr><td><input type="text" value="${esc(r.match)}" data-rulematch="${i}" style="width:100%"></td>
      <td><select data-rulecat="${i}">${catOptions(r.cat)}</select></td>
      <td><button class="link" data-act="ruledel" data-i="${i}" aria-label="Удалить">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Своих правил пока нет.</p>'}
  <form class="row" data-form="ruleadd" style="margin-top:10px" autocomplete="off">
    <input type="text" name="match" class="grow" placeholder="Например: петров (перевод за квартиру)" required>
    <select name="cat">${catOptions('rent')}</select>
    <button type="submit">Добавить правило</button>
  </form>
  <div class="row" style="margin-top:10px"><button data-act="recat">Перераспределить загруженные операции по правилам</button></div>
  <p class="muted small">Операции, где категория выбрана вручную, не трогаются.</p>

  <h2>Данные</h2>
  <p class="muted small">Всё хранится в этом браузере. Чтобы перенести данные на телефон или не потерять их при очистке браузера, сохраняйте копию.</p>
  <div class="row">
    <button data-act="export">Сохранить копию (JSON)</button>
    <label class="btn"><input type="file" id="jsonfile" accept=".json,application/json" hidden>Загрузить копию</label>
    <button data-act="exportcsv">Операции в CSV</button>
  </div>
  <h2>Вид</h2>
  <label class="field" style="max-width:240px">Тема<select data-setting="theme">
    <option value="auto"${s.theme === 'auto' ? ' selected' : ''}>как в системе</option>
    <option value="light"${s.theme === 'light' ? ' selected' : ''}>светлая</option>
    <option value="dark"${s.theme === 'dark' ? ' selected' : ''}>тёмная</option></select></label>
  <h2>Сброс</h2>
  <button class="danger" data-act="reset">Удалить все данные</button>`;
}

function planCalc() {
  const p = plan(state);
  const f = forecast(state);
  return `<p style="margin-top:16px">Доход ${money(p.income)} − налог ${money(p.tax)} − аренда ${money(p.rent)} − лимиты ${money(p.limits)} =
    <b class="${p.savings > 0 ? '' : 'bad'}">план накоплений ${money(p.savings)} в месяц</b>.
    ${p.savings > 0 && f.left > 0 ? `При таком темпе цель будет через ${Math.ceil(f.left / p.savings)} мес.` : ''}</p>`;
}

// ---------- выгрузка ----------
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- отрисовка ----------
const VIEWS = { overview: vOverview, ops: vOps, import: vImport, habits: vHabits, basket: vBasket, food: vFood, settings: vSettings };

function render() {
  applyTheme();
  weekRollover();
  const r = route();
  document.getElementById('nav').innerHTML = ROUTES.map(([id, name]) =>
    `<a href="#${id}"${id === r ? ' aria-current="page"' : ''}>${name}</a>`).join('');
  $app.innerHTML = (storageOk ? '' : '<p class="callout bad">Браузер не даёт сохранять данные (приватный режим?). Всё, что вы введёте, пропадёт после закрытия страницы.</p>') + VIEWS[r]();
  bindDrop();
}

function bindDrop() {
  const drop = document.getElementById('drop');
  if (!drop) return;
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0]; if (f) readCSV(f);
  });
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'month') {
    const d = Number(el.dataset.d);
    ui.month = d === 0 ? monthKey(today()) : addMonths(ui.month, d);
    render();
  } else if (act === 'deltx') {
    state.tx = state.tx.filter(t => t.id !== el.dataset.id);
    persist();
    document.getElementById('ops-list').innerHTML = opsList();
    toast('Операция удалена');
  } else if (act === 'doimport') doImport();
  else if (act === 'cancelimport') { ui.imp = null; render(); }
  else if (act === 'hmonths') { ui.habitsMonths = Number(el.dataset.n); render(); }
  else if (act === 'bdel') { state.basket.items = state.basket.items.filter(i => i.id !== el.dataset.id); commit(); }
  else if (act === 'breset') { state.basket.checked = {}; commit('Отметки сняты'); }
  else if (act === 'bdefault') {
    if (confirm('Вернуть список продуктов и цены по умолчанию?')) { state.basket.items = defaultState().basket.items; commit('Список восстановлен'); }
  } else if (act === 'wdel') { state.weights = state.weights.filter(w => w.date !== el.dataset.date); commit(); }
  else if (act === 'ruledel') { state.rules.splice(Number(el.dataset.i), 1); commit('Правило удалено'); }
  else if (act === 'recat') {
    let n = 0;
    for (const t of state.tx) {
      if (t.src !== 'import' || t.catManual || !t.raw) continue;
      const c = categorize({ desc: t.note, bankCat: t.raw.bankCat, mcc: t.raw.mcc, signedAmount: t.raw.signed }, state.rules);
      if (c.cat !== t.cat || c.amount !== t.amount) { t.cat = c.cat; t.amount = c.amount; n++; }
    }
    commit(`Изменено операций: ${n}`);
  } else if (act === 'export') {
    download(`kopilka-${today()}.json`, JSON.stringify(state, null, 1), 'application/json');
  } else if (act === 'exportcsv') {
    const rows = [['Дата', 'Категория', 'Сумма', 'Описание']].concat(
      state.tx.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, CAT[t.cat]?.name || t.cat, String(t.amount).replace('.', ','), t.note || '']));
    download(`kopilka-operacii-${today()}.csv`, '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
  } else if (act === 'reset') {
    if (confirm('Удалить все операции, настройки и записи веса из этого браузера? Сначала стоит сохранить копию.')) {
      state = defaultState(); commit('Данные удалены');
    }
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  const d = el.dataset;
  if (d.txcat) setTxCat(d.txcat, el.value);
  else if (d.filter && el.tagName === 'SELECT') { ui[d.filter] = el.value; document.getElementById('ops-list').innerHTML = opsList(); }
  else if (d.setting) {
    const k = d.setting;
    if (el.type === 'checkbox') state.settings[k] = el.checked;
    else if (el.type === 'number' || k === 'taxRate') state.settings[k] = Math.max(0, Number(el.value) || 0);
    else state.settings[k] = el.value;
    persist();
    if (k === 'theme') applyTheme();
    const pc = document.getElementById('plan-calc'); if (pc) pc.innerHTML = planCalc();
  } else if (d.limit) {
    state.limits[d.limit] = Math.max(0, Number(el.value) || 0);
    persist();
    document.getElementById('plan-calc').innerHTML = planCalc();
  } else if (d.bcheck) {
    if (el.checked) state.basket.checked[d.bcheck] = true; else delete state.basket.checked[d.bcheck];
    commit();
  } else if (d.bprice) {
    const it = state.basket.items.find(i => i.id === d.bprice);
    if (it) { it.price = Math.max(0, Number(el.value) || 0); commit(); }
  } else if (d.rulematch) {
    const v = el.value.trim().toLowerCase();
    if (v) { state.rules[Number(d.rulematch)].match = v; persist(); toast('Правило изменено'); }
  } else if (d.rulecat) { state.rules[Number(d.rulecat)].cat = el.value; persist(); toast('Правило изменено'); }
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
  if (e.target.dataset.filter === 'opsQuery') {
    ui.opsQuery = e.target.value;
    document.getElementById('ops-list').innerHTML = opsList();
  }
});

document.addEventListener('submit', e => {
  const form = e.target;
  const kindF = form.dataset.form;
  if (!kindF) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  if (kindF === 'add') {
    const amount = Number(String(fd.amount).replace(',', '.'));
    if (!amount) return;
    ui.lastCat = fd.cat;
    state.tx.push({ id: uid(), date: fd.date || today(), cat: fd.cat, amount: kind(fd.cat) === 'expense' ? amount : Math.abs(amount), note: fd.note.trim(), src: 'manual', ts: Date.now(), catManual: true });
    commit(`Добавлено: ${CAT[fd.cat].name}, ${money(Math.abs(amount))}`);
  } else if (kindF === 'badd') {
    state.basket.items.push({ id: uid(), group: 'Добавлено', name: fd.name.trim(), qty: fd.qty.trim(), price: Number(fd.price) || 0 });
    commit('Продукт добавлен');
  } else if (kindF === 'bbuy') {
    const sum = Number(fd.sum);
    if (!sum) return;
    const date = fd.date || today();
    state.tx.push({ id: uid(), date, cat: 'food', amount: sum, note: 'Продукты по корзине', src: 'manual', ts: Date.now(), catManual: true });
    const week = isoWeek(date);
    const prev = state.basket.history.find(h => h.week === week);
    if (prev) { prev.actual += sum; prev.planned = basketTotal(); }
    else state.basket.history.push({ week, planned: basketTotal(), actual: sum });
    commit(`Записано: продукты ${money(sum)}`);
  } else if (kindF === 'weight') {
    const kg = Number(String(fd.kg).replace(',', '.'));
    if (!kg) return;
    state.weights = state.weights.filter(w => w.date !== fd.date).concat({ date: fd.date || today(), kg });
    commit('Вес записан');
  } else if (kindF === 'ruleadd') {
    const m = fd.match.trim().toLowerCase();
    if (!m) return;
    state.rules = state.rules.filter(r => r.match !== m);
    state.rules.unshift({ match: m, cat: fd.cat });
    commit('Правило добавлено. Нажмите «Перераспределить», чтобы применить к загруженным операциям.');
  }
});

render();

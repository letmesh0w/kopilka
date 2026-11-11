import { CAT, CATEGORIES } from './data.js';
import { monthKey, addMonths, monthsBetween, weekday, today, daysBetween, num } from './store.js';
import { merchantKey } from './categorize.js';

const kindOf = tx => (CAT[tx.cat] || CAT.other).kind;

export const LIMITED = CATEGORIES.filter(c => c.limit != null).map(c => c.id);

export function plan(state) {
  const s = state.settings;
  const tax = Math.round((s.income * s.taxRate) / 100);
  const limits = LIMITED.reduce((a, id) => a + (Number(state.limits[id]) || 0), 0);
  const spend = tax + Number(s.rent || 0) + limits;
  return { income: Number(s.income) || 0, tax, rent: Number(s.rent) || 0, limits, spend, savings: (Number(s.income) || 0) - spend };
}

export function limitFor(state, cat) {
  if (cat === 'tax') return plan(state).tax;
  if (cat === 'rent') return Number(state.settings.rent) || 0;
  return Number(state.limits[cat]) || 0;
}

export function monthSummary(state, mk) {
  const r = { month: mk, income: 0, spent: 0, saved: 0, byCat: {}, count: 0 };
  for (const t of state.tx) {
    if (monthKey(t.date) !== mk) continue;
    const k = kindOf(t);
    r.count++;
    if (k === 'income') r.income += t.amount;
    else if (k === 'expense') { r.spent += t.amount; r.byCat[t.cat] = (r.byCat[t.cat] || 0) + t.amount; }
    else if (k === 'save') r.saved += t.amount;
    else if (k === 'unsave') r.saved -= t.amount;
  }
  r.left = r.income - r.spent - r.saved; // не распределено (на карте)
  return r;
}

export function savingsBalance(state) {
  let b = Number(state.settings.initialSavings) || 0;
  for (const t of state.tx) {
    const k = kindOf(t);
    if (k === 'save') b += t.amount;
    else if (k === 'unsave') b -= t.amount;
  }
  return b;
}

export function trackedMonths(state) {
  const cur = monthKey(today());
  let first = state.settings.startMonth || cur;
  for (const t of state.tx) if (monthKey(t.date) < first) first = monthKey(t.date);
  return monthsBetween(first, cur > first ? cur : first);
}

// Итог месяца: выполнен ли план накоплений и где превышены лимиты.
export function verdict(state, mk) {
  const p = plan(state);
  const s = monthSummary(state, mk);
  const over = LIMITED.concat(['rent'])
    .map(id => ({ id, spent: s.byCat[id] || 0, limit: limitFor(state, id) }))
    .filter(x => x.limit > 0 && x.spent > x.limit);
  return { ...s, plan: p.savings, met: p.savings > 0 && s.saved >= p.savings, over };
}

export function history(state) {
  return trackedMonths(state).map(mk => verdict(state, mk));
}

// Серия месяцев подряд с выполненным планом (текущий месяц засчитывается, только если уже выполнен).
export function streak(state) {
  const cur = monthKey(today());
  const h = history(state);
  let n = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].month === cur && !h[i].met) continue;
    if (h[i].met) n++; else break;
  }
  return n;
}

export function forecast(state) {
  const p = plan(state);
  const target = (Number(state.settings.goalAmount) || 0) + (Number(state.settings.cushion) || 0);
  const balance = savingsBalance(state);
  const left = Math.max(0, target - balance);
  const cur = monthKey(today());
  const past = history(state).filter(h => h.month < cur && h.count > 0).slice(-3);
  const avg = past.length ? past.reduce((a, h) => a + h.saved, 0) / past.length : p.savings;
  const pace = avg > 0 ? avg : p.savings;
  const months = pace > 0 ? Math.ceil(left / pace) : null;
  return {
    target, balance, left, pace, paceSource: past.length ? 'факт' : 'план',
    months, doneMonth: months != null ? addMonths(cur, months) : null,
    pct: target ? Math.min(100, (balance / target) * 100) : 0,
  };
}

// ---- привычки ----
export function habits(state, monthsBack = 3, basketWeekCost = 0) {
  const cur = monthKey(today());
  const from = addMonths(cur, -(monthsBack - 1));
  const months = monthsBetween(from, cur);
  const exp = state.tx.filter(t => kindOf(t) === 'expense' && monthKey(t.date) >= from && t.amount > 0);
  const nMonths = months.length;

  const byCat = {};
  for (const t of exp) byCat[t.cat] = (byCat[t.cat] || 0) + t.amount;
  const catAvg = Object.entries(byCat)
    .map(([cat, sum]) => ({ cat, avg: sum / nMonths, limit: limitFor(state, cat) }))
    .sort((a, b) => b.avg - a.avg);

  const merchants = new Map();
  for (const t of exp) {
    if (t.cat === 'rent' || t.cat === 'tax') continue;
    const k = merchantKey(t.note) || '(без описания)';
    const m = merchants.get(k) || { key: k, sum: 0, count: 0, cat: t.cat, months: new Map() };
    m.sum += t.amount; m.count++;
    const mk = monthKey(t.date);
    m.months.set(mk, (m.months.get(mk) || []).concat(t.amount));
    merchants.set(k, m);
  }
  const top = [...merchants.values()].sort((a, b) => b.sum - a.sum).slice(0, 10);

  // Похоже на подписку: одно место, есть в 2+ разных месяцах, суммы отличаются не больше чем на 10%, 1–2 платежа в месяц.
  const subs = [...merchants.values()].filter(m => {
    if (m.months.size < 2) return false;
    const all = [...m.months.values()];
    if (all.some(a => a.length > 2)) return false;
    const flat = all.flat();
    const min = Math.min(...flat), max = Math.max(...flat);
    return max <= min * 1.1 && ['fun', 'bills', 'sport', 'other', 'market'].includes(m.cat);
  }).map(m => ({ key: m.key, monthly: [...m.months.values()].flat().reduce((a, b) => a + b, 0) / m.months.size }));

  const wd = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));
  for (const t of exp) {
    if (['rent', 'tax', 'transfer'].includes(t.cat)) continue;
    const w = wd[weekday(t.date)]; w.sum += t.amount; w.count++;
  }

  const small = exp.filter(t => t.amount < 500 && !['rent', 'tax', 'transfer'].includes(t.cat));
  const smallSum = small.reduce((a, t) => a + t.amount, 0);

  const cafe = exp.filter(t => t.cat === 'cafe');
  const cafeSum = cafe.reduce((a, t) => a + t.amount, 0);
  const homeDay = basketWeekCost > 0 ? basketWeekCost / 7 : 0;

  // Сравнение с прошлым месяцем
  const prev = monthSummary(state, addMonths(cur, -1)).byCat;
  const now = monthSummary(state, cur).byCat;
  const elapsed = Number(today().slice(8, 10));
  const deltas = Object.keys({ ...prev, ...now })
    .filter(c => !['rent', 'tax'].includes(c))
    .map(c => ({ cat: c, prev: prev[c] || 0, now: now[c] || 0 }))
    .filter(d => d.prev || d.now)
    .sort((a, b) => Math.abs(b.now - b.prev) - Math.abs(a.now - a.prev));

  const insights = [];
  if (exp.length) {
    const share = c => (byCat[c] || 0) / exp.reduce((a, t) => a + t.amount, 0);
    if (cafe.length) {
      insights.push(`Кафе и доставка: ${cafe.length} раз за период, в среднем ${num(cafeSum / cafe.length)} ₽ за раз` +
        (homeDay ? `. На эти деньги можно было бы питаться дома ${num(cafeSum / homeDay)} дн..` : '.'));
    }
    if (small.length) insights.push(`Мелкие траты до 500 ₽: ${small.length} шт., в среднем ${num(smallSum / nMonths)} ₽ в месяц.`);
    if (subs.length) insights.push(`Похоже на регулярные платежи: ${subs.length}, вместе около ${num(subs.reduce((a, s) => a + s.monthly, 0))} ₽ в месяц. Проверьте, все ли нужны.`);
    const wMax = wd.reduce((a, w, i) => (w.sum > wd[a].sum ? i : a), 0);
    const avgDay = wd.reduce((a, w) => a + w.sum, 0) / 7;
    if (wd[wMax].sum > avgDay * 1.5) insights.push(`Больше всего тратится по дням недели: ${WD_FULL[wMax]} (в 1,5+ раза выше среднего).`);
    const mk = share('market');
    if (mk > 0.15) insights.push(`На маркетплейсы уходит ${Math.round(mk * 100)}% трат без аренды и налога.`);
    for (const c of catAvg) {
      if (c.limit > 0 && c.avg > c.limit * 1.2 && !['rent', 'tax'].includes(c.cat)) {
        insights.push(`«${CAT[c.cat].name}» в среднем ${num(c.avg)} ₽ в месяц при лимите ${num(c.limit)} ₽.`);
      }
    }
  }
  return { months, catAvg, top, subs, wd, smallCount: small.length, smallSum, cafeCount: cafe.length, cafeSum, deltas, elapsed, insights };
}

export const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

// ---- вес ----
// Темп набора за последние 21 день по линейной регрессии, кг в неделю.
export function weightTrend(weights) {
  const w = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  if (w.length < 3) return null;
  const last = w[w.length - 1].date;
  const pts = w.filter(x => daysBetween(x.date, last) <= 21).map(x => [daysBetween(last, x.date), x.kg]);
  if (pts.length < 3 || daysBetween(w.find(x => daysBetween(x.date, last) <= 21).date, last) < 7) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  if (!sxx) return null;
  const perWeek = (sxy / sxx) * 7;
  let advice;
  if (perWeek < 0.1) advice = 'Вес почти стоит: добавьте около 200 ккал в день (50 г риса или банан с ложкой арахисовой пасты).';
  else if (perWeek < 0.25) advice = 'Набор медленнее плана: можно добавить 100–200 ккал в день.';
  else if (perWeek <= 0.5) advice = 'Темп в норме, ничего не меняйте.';
  else advice = 'Набор быстрее 0,5 кг в неделю: уберите около 200 ккал в день.';
  return { perWeek, advice };
}

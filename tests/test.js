// Запуск: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/test.js
import { parseCSV, findHeaderRow, detectColumns, rowsToOperations, parseAmount, parseDate, opHash } from '../js/csv.js';
import { categorize, merchantKey } from '../js/categorize.js';
import { defaultState, isoWeek, addMonths, monthKey, today } from '../js/store.js';
import { plan, monthSummary, forecast, habits, weightTrend, verdict } from '../js/analytics.js';

let fails = 0, passes = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else { fails++; print(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// --- суммы и даты
eq('amount ru', parseAmount('-1 234,50'), -1234.5);
eq('amount nbsp', parseAmount('−12 000,00 ₽'), -12000);
eq('amount en', parseAmount('1,234.56'), 1234.56);
eq('amount plain', parseAmount('350'), 350);
eq('date ru', parseDate('10.11.2026 19:22:10'), '2026-11-10');
eq('date iso', parseDate('2026-11-03'), '2026-11-03');
eq('date short', parseDate('3.1.26'), '2026-01-03');

// --- выписка в духе Т-Банка
const tbank = `"Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";"MCC";"Описание";"Бонусы (включая кэшбэк)";"Округление на инвесткопилку";"Сумма операции с округлением"
"10.11.2026 19:22:10";"11.11.2026";"*1234";"OK";"-1234,50";"RUB";"-1234,50";"RUB";"";"Супермаркеты";"5411";"Пятёрочка";"12,00";"0,00";"1234,50"
"09.11.2026 08:01:00";"09.11.2026";"*1234";"OK";"-390,00";"RUB";"-390,00";"RUB";"";"Фастфуд";"5814";"Вкусно и точка";"0,00";"0,00";"390,00"
"08.11.2026 12:00:00";"08.11.2026";"*1234";"FAILED";"-5000,00";"RUB";"-5000,00";"RUB";"";"Переводы";"";"Иван И.";"0,00";"0,00";"5000,00"
"05.11.2026 10:00:00";"05.11.2026";"";"OK";"150000,00";"RUB";"150000,00";"RUB";"";"Пополнения";"";"ООО Ромашка";"0,00";"0,00";"150000,00"
"05.11.2026 10:05:00";"05.11.2026";"";"OK";"-60000,00";"RUB";"-60000,00";"RUB";"";"Переводы";"";"Перевод на накопительный счет";"0,00";"0,00";"60000,00"
"04.11.2026 21:00:00";"04.11.2026";"*1234";"OK";"-12,50";"USD";"-1150,00";"RUB";"";"Цифровые товары";"5815";"STEAMGAMES.COM";"0,00";"0,00";"1150,00"
"03.11.2026 09:00:00";"03.11.2026";"*1234";"OK";"799,00";"RUB";"799,00";"RUB";"";"Маркетплейсы";"5262";"Возврат OZON";"0,00";"0,00";"799,00"
"02.11.2026 09:00:00";"02.11.2026";"*1234";"OK";"-450,00";"RUB";"-450,00";"RUB";"";"Мобильная связь";"4814";"MTS";"0,00";"0,00";"450,00"
"01.11.2026 09:00:00";"01.11.2026";"*1234";"OK";"-300,00";"RUB";"-300,00";"RUB";"";"Разное";"";"PAYMENTS SYSTEM";"0,00";"0,00";"300,00"
`;
const rows = parseCSV(tbank);
const hi = findHeaderRow(rows);
const map = detectColumns(rows[hi]);
eq('header', hi, 0);
eq('map', [map.date, map.amount, map.desc, map.bankCat, map.mcc, map.status, map.income], [0, 6, 11, 9, 10, 3, -1]);
const { ops, errors } = rowsToOperations(rows, hi, map);
eq('ops count (failed skipped)', ops.length, 8);
eq('errors', errors, []);
const cats = ops.map(o => categorize(o, []));
eq('categories', cats.map(c => c.cat), ['food', 'cafe', 'income', 'save', 'fun', 'market', 'bills', 'other']);
eq('steam in rub', cats[4].amount, 1150);
eq('refund negative', cats[5].amount, -799);
eq('hash stable', opHash(ops[0]), opHash({ ...ops[0] }));

// --- правило пользователя важнее встроенного
eq('user rule', categorize({ desc: 'Перевод Петров П.', signedAmount: -40000 }, [{ match: 'петров', cat: 'rent' }]).cat, 'rent');
eq('magnit kosmetik', categorize({ desc: 'MAGNIT KOSMETIK / Магнит Косметик', signedAmount: -100 }).cat, 'home');
eq('mts word boundary', categorize({ desc: 'SHIPMENTS LTD', signedAmount: -100 }).cat, 'other');
eq('merchant key', merchantKey('PYATEROCHKA 1234 MOSCOW RUS'), 'pyaterochka');

// --- раздельные столбцы расход/приход, cp1251-подобный заголовок с преамбулой
const alfa = `Выписка по счёту
Период: 01.10.2026 - 31.10.2026
Дата;Описание;Расход;Приход
01.10.2026;Аренда квартиры;40000,00;
02.10.2026;Клиент;;25000,00
`;
const r2 = parseCSV(alfa);
const h2 = findHeaderRow(r2);
const m2 = detectColumns(r2[h2]);
eq('alfa header', h2, 2);
eq('alfa map', [m2.amount, m2.income], [2, 3]);
const o2 = rowsToOperations(r2, h2, m2).ops;
eq('alfa signs', o2.map(o => o.signedAmount), [-40000, 25000]);

// --- план и итоги
const st = defaultState();
st.settings.income = 150000; st.settings.rent = 40000; st.settings.taxRate = 6;
eq('plan savings', plan(st).savings, 60000);
const mk = monthKey(today());
st.tx.push({ id: 'a', date: today(), cat: 'income', amount: 150000, note: '' });
st.tx.push({ id: 'b', date: today(), cat: 'save', amount: 60000, note: '' });
st.tx.push({ id: 'c', date: today(), cat: 'food', amount: 20000, note: 'Пятёрочка' });
st.tx.push({ id: 'd', date: today(), cat: 'food', amount: -500, note: 'Возврат' });
const ms = monthSummary(st, mk);
eq('summary', [ms.income, ms.saved, ms.spent], [150000, 60000, 19500]);
const v = verdict(st, mk);
eq('verdict met', v.met, true);
eq('over food', v.over.map(o => o.id), ['food']);
const f = forecast(st);
eq('forecast left', f.left, 290000);
eq('forecast months', f.months, 5);

// --- недели и месяцы
eq('isoWeek', isoWeek('2026-11-11'), '2026-W46');
eq('isoWeek new year', isoWeek('2027-01-01'), '2026-W53');
eq('addMonths', addMonths('2026-11', 3), '2027-02');

// --- привычки не падают на пустых и непустых данных
const hb = habits(st, 3, 4150);
eq('habits top', hb.top[0].key, 'пятерочка');
eq('habits empty', habits(defaultState()).insights, []);

// --- вес
eq('weight none', weightTrend([{ date: '2026-11-01', kg: 70 }]), null);
const wt = weightTrend([{ date: '2026-11-01', kg: 70 }, { date: '2026-11-08', kg: 70.3 }, { date: '2026-11-15', kg: 70.6 }]);
eq('weight trend', Math.round(wt.perWeek * 100) / 100, 0.3);

print(`${passes} passed, ${fails} failed`);

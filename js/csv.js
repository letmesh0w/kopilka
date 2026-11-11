// Чтение банковских выписок в CSV: кодировка, разделитель, поиск заголовка, сопоставление столбцов.

export function decodeBytes(buf) {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
  let best = ';', bestCount = -1;
  for (const d of [';', ',', '\t']) {
    let count = 0, inQ = false;
    for (const ch of sample) {
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

export function parseCSV(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row.map(c => c.trim()));
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row.map(c => c.trim()));
  return rows;
}

export function parseAmount(s) {
  if (s == null) return NaN;
  let t = String(s).replace(/[  \s]/g, '').replace(/[−–]/g, '-').replace(/[^\d,.\-+]/g, '');
  if (!t) return NaN;
  // «1.234,56» → «1234.56»; «1,234.56» → «1234.56»; «1234,56» → «1234.56»
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  return Number(t);
}

// → 'YYYY-MM-DD' или null
export function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const low = s => String(s || '').toLowerCase().replace(/ё/g, 'е');

// Строка заголовка — первая, где есть ячейка со словом «дата» (или date) и ячейка «сумма» (или amount).
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(low);
    if (cells.some(c => /дата|date/.test(c)) && cells.some(c => /сумм|amount|расход|приход|списан/.test(c))) return i;
  }
  return 0;
}

function pick(headers, tests, exclude = []) {
  for (const test of tests) {
    const i = headers.findIndex(h => test.test(h) && !exclude.some(e => e.test(h)));
    if (i >= 0) return i;
  }
  return -1;
}

// Автоматическое сопоставление столбцов. Индексы −1 — нет столбца.
export function detectColumns(header) {
  const h = header.map(low);
  const noise = [/округлен/, /кэшбэк|кешбэк|cashback/, /бонус/, /комисс/, /остаток|balance/, /дата|date/];
  const map = {
    date: pick(h, [/^дата операции/, /дата.*операц/, /^дата$/, /дата/, /date/], [/платеж|списани|обработк/]),
    amount: pick(h, [/сумма платежа/, /сумма в валюте счета/, /сумма операции/, /^сумма/, /сумма/, /amount/, /расход|списан|дебет/], noise),
    income: -1,
    desc: pick(h, [/^описание/, /описание/, /назначение/, /контрагент|получател|место|merchant|description/]),
    bankCat: pick(h, [/^категория/, /категория/, /category/]),
    mcc: pick(h, [/^mcc/, /mcc/]),
    status: pick(h, [/статус/, /status/]),
  };
  if (map.date < 0) map.date = pick(h, [/дата/]);
  // Отдельные столбцы «Расход» и «Приход»
  const debit = pick(h, [/^расход/, /списан/, /дебет/], noise);
  const credit = pick(h, [/^приход/, /поступлен|зачислен|кредит/], noise);
  if (debit >= 0 && credit >= 0) { map.amount = debit; map.income = credit; }
  return map;
}

const BAD_STATUS = /failed|отклон|отказ|ошибк|cancel|отмен|declin/;

/**
 * Превращает строки выписки в операции банка { rawDate, date, signedAmount, desc, bankCat, mcc }.
 * Если задан отдельный столбец прихода, столбец суммы считается расходом.
 */
export function rowsToOperations(rows, headerIndex, map) {
  const out = [];
  const errors = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const get = idx => (idx >= 0 && idx < r.length ? r[idx] : '');
    if (map.status >= 0 && BAD_STATUS.test(low(get(map.status)))) continue;
    const date = parseDate(get(map.date));
    let signed;
    if (map.income >= 0) {
      const out_ = parseAmount(get(map.amount));
      const in_ = parseAmount(get(map.income));
      if (!isNaN(in_) && in_ !== 0) signed = Math.abs(in_);
      else if (!isNaN(out_) && out_ !== 0) signed = -Math.abs(out_);
    } else {
      signed = parseAmount(get(map.amount));
      if (map.invert) signed = -signed;
    }
    if (!date || signed == null || isNaN(signed) || signed === 0) {
      if (r.filter(Boolean).length > 2) errors.push(i + 1);
      continue;
    }
    out.push({
      rawDate: get(map.date),
      date,
      signedAmount: Math.round(signed * 100) / 100,
      desc: get(map.desc),
      bankCat: get(map.bankCat),
      mcc: get(map.mcc),
    });
  }
  return { ops: out, errors };
}

export function opHash(op) {
  return `${op.rawDate}|${op.signedAmount.toFixed(2)}|${low(op.desc).replace(/\s+/g, ' ').trim()}`;
}

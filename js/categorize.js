import { CAT, KEYWORDS, MCC, BANK_CATEGORIES } from './data.js';

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ \s]+/g, ' ')
    .trim();
}

// Ключ «места»: описание без цифр и мусора, первые три слова. Используется для правил и группировки.
export function merchantKey(desc) {
  const words = normalize(desc)
    .replace(/[0-9]+/g, ' ')
    .replace(/[*#№"«»()[\]{}|\\/_,.:;!?+=~^-]+/g, ' ')
    .split(' ')
    .filter(w => w.length > 1 && !['rus', 'ru', 'moscow', 'москва', 'msk', 'g', 'г'].includes(w));
  return words.slice(0, 3).join(' ') || normalize(desc).slice(0, 30);
}

// Короткие слова (до 4 букв) ищем только с начала слова, чтобы «mts» не находилось внутри посторонних слов.
function contains(text, kw) {
  const k = normalize(kw);
  if (k.length > 4) return text.includes(k);
  let from = 0;
  while (true) {
    const i = text.indexOf(k, from);
    if (i < 0) return false;
    if (i === 0 || !/[a-zа-я0-9]/.test(text[i - 1])) return true;
    from = i + 1;
  }
}

const KEYWORD_LIST = Object.entries(KEYWORDS)
  .flatMap(([cat, words]) => words.map(w => [normalize(w), cat]))
  .sort((a, b) => b[0].length - a[0].length);

const MCC_MAP = new Map(MCC.flatMap(([codes, cat]) => codes.map(c => [c, cat])));

function byKeyword(text, rules) {
  for (const r of rules) {
    if (r.match && contains(text, r.match)) return r.cat;
  }
  for (const [kw, cat] of KEYWORD_LIST) {
    if (contains(text, kw)) return cat;
  }
  return null;
}

function byBankCategory(bankCat) {
  const b = normalize(bankCat);
  if (!b) return null;
  for (const [needle, cat] of BANK_CATEGORIES) if (b.includes(needle)) return cat;
  return null;
}

/**
 * Разбор одной банковской операции.
 * signedAmount: отрицательная — списание, положительная — поступление.
 * Возвращает { cat, amount }, где amount в знаке категории: трата > 0, возврат покупки < 0.
 */
export function categorize({ desc, bankCat, mcc, signedAmount }, rules = []) {
  const text = normalize(desc);
  const bankText = normalize(bankCat);
  const kw = byKeyword(text, rules);
  const abs = Math.abs(signedAmount);

  if (signedAmount < 0) {
    let cat = kw;
    if (!cat && mcc) cat = MCC_MAP.get(Number(mcc)) || null;
    if (!cat) cat = byBankCategory(bankCat);
    if (cat && CAT[cat] && CAT[cat].kind === 'income') cat = 'other';
    if (cat === 'unsave') cat = 'save'; // списание с карты «с накопительного» не бывает; считаем пополнением
    return { cat: cat || 'other', amount: abs };
  }

  // Поступление
  const isRefund = /возврат|refund|отмена покупки|отмена операции/.test(text) || /возврат/.test(bankText);
  if (isRefund) {
    let cat = kw;
    if (!cat && mcc) cat = MCC_MAP.get(Number(mcc)) || null;
    if (!cat) cat = byBankCategory(bankCat);
    if (cat && CAT[cat] && CAT[cat].kind === 'expense') return { cat, amount: -abs };
    return { cat: 'income_other', amount: abs };
  }
  if (kw === 'save' || kw === 'unsave') return { cat: 'unsave', amount: abs };
  if (kw === 'internal') return { cat: 'internal', amount: abs };
  if (kw === 'income_other' || /кэшбэк|кешбэк|бонус|процент/.test(bankText)) return { cat: 'income_other', amount: abs };
  if (kw && CAT[kw] && CAT[kw].kind === 'income') return { cat: kw, amount: abs };
  return { cat: 'income', amount: abs };
}

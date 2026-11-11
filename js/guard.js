// Проверки без обращения к браузеру: формат кода восстановления, стойкость пароля, задержки входа.

// В коде нет похожих знаков (0, O, 1, I); всё лишнее, включая дефисы и пробелы, отбрасывается.
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
}
export const codeLooksValid = s => normalizeCode(s).length === 24;

// ---- проверка нового пароля; возвращает причину отказа или '' ----
const COMMON = ['password', 'parol', 'пароль', 'qwerty', 'йцукен', '123456', '111111', 'kopilka', 'копилка', 'letmein', 'admin', 'iloveyou', 'abc123', 'zxcvbn', 'qazwsx', '654321', 'q1w2e3'];
export function weakPassword(p) {
  p = String(p || '');
  if (p.length < 10) return 'Пароль должен быть не короче 10 символов.';
  if (new Set(p).size < 6) return 'В пароле слишком мало разных символов.';
  if (/^\d+$/.test(p) && p.length < 16) return 'Пароль из одних цифр легко подобрать. Добавьте буквы или сделайте его длиннее 15 цифр.';
  const low = p.toLowerCase();
  if (COMMON.some(w => low.includes(w)) && p.length < 16) return 'Пароль содержит слишком частое слово или сочетание.';
  return '';
}

// ---- задержки после неверных попыток входа: [секунд ожидания] по числу ошибок подряд ----
export const WIPE_AFTER = 10;
export function lockoutSeconds(fails) {
  return [0, 0, 0, 5, 15, 30, 60, 120, 300, 600][Math.min(fails, 9)];
}

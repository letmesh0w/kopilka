// Иконки (24×24, линия 2px) и оформление категорий.
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bag: '<path d="M4 7h16l-1.5 13h-13z"/><path d="M8.5 7a3.5 3.5 0 0 1 7 0"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.2"/>',
  chart: '<path d="M3 20h18"/><path d="M6.5 16v-4M11.5 16V6M16.5 16v-7"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6A3.7 3.7 0 0 1 17.5 18.5z"/>',
  cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/><path d="M3 4h2l2.4 11.5h10.8L20.5 7.5H6"/>',
  coffee: '<path d="M4 9h12v4.5A5.5 5.5 0 0 1 10.5 19h-1A5.5 5.5 0 0 1 4 13.5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2.5M12 3.5v2.5"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21v-3M16 21v-3M8.5 14.5h.01M15.5 14.5h.01"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M9 16a4.5 4.5 0 0 1 6 0"/><path d="M12 19.5h.01" stroke-width="3"/>',
  dumbbell: '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>',
  house: '<path d="M4 10.5L12 4l8 6.5V20H4z"/><path d="M10 20v-5.5h4V20"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  shirt: '<path d="M8.5 3.5L3.5 6.5l2 4 2.5-1V20h8V9.5l2.5 1 2-4-5-3a3.5 3.5 0 0 1-7 0z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.7v6.6l5.5-3.3z"/>',
  box: '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11h5.5M19 8.5l2.5 2.5-2.5 2.5"/>',
  dots: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3.2"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
  arrowIn: '<path d="M12 4v14M6 12l6 6 6-6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10.5h18M16 15h2"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>',
  coinsOut: '<ellipse cx="10" cy="7" rx="6" ry="2.5"/><path d="M4 7v5.5c0 1.4 2.7 2.5 6 2.5M4 12.5V18c0 1.4 2.7 2.5 6 2.5M16 7v3"/><path d="M15 17.5h6.5M18.5 14.5l3 3-3 3"/>',
  repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M16.5 2.5L20 6l-3.5 3.5"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4M7.5 21.5L4 18l3.5-3.5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 10a5 5 0 0 1 8 0"/><path d="M12 10.5l1.5-2"/>',
  utensils: '<path d="M7 3v7.5a2 2 0 0 0 4 0V3M9 12.5V21M17 21V3c-2 1-3.5 4-3.5 8.5H17"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 3.5M16 6h2.5a2.5 2.5 0 0 1-2.6 3.5M12 13v4M8.5 20.5h7"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3h.01" stroke-width="2.4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.6 1 2.5h6c0-.9.2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  flame: '<path d="M12 21c-3.9 0-7-2.6-7-6.6C5 10 9 8.5 9 3.5c3 1.5 6 4.6 6 8.4 1-1 1.5-2 1.5-3.4 1.8 1.5 2.5 3.6 2.5 5.9 0 4-3.1 6.6-7 6.6z"/>',
  sparkle: '<path d="M12 3l2 5.5L19.5 10.5 14 12.5 12 18l-2-5.5L4.5 10.5 10 8.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  ruble: '<circle cx="12" cy="12" r="9"/><path d="M10.2 17V7.5h3a2.6 2.6 0 0 1 0 5.2H8.6M8.6 14.9h5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.dots}</svg>`;
}

// Цвет категории — только для иконки; название всегда подписано рядом.
export const CAT_STYLE = {
  income: ['arrowIn', 'green'], income_other: ['wallet', 'green'],
  tax: ['receipt', 'gray'], rent: ['key', 'violet'],
  food: ['cart', 'orange'], cafe: ['coffee', 'magenta'], transport: ['bus', 'blue'], bills: ['wifi', 'aqua'],
  sport: ['dumbbell', 'red'], home: ['house', 'yellow'], health: ['heart', 'red'], clothes: ['shirt', 'magenta'],
  fun: ['play', 'violet'], market: ['box', 'yellow'], transfer: ['people', 'blue'], other: ['dots', 'gray'],
  tech: ['monitor', 'blue'], save: ['coins', 'green'], unsave: ['coinsOut', 'orange'], internal: ['repeat', 'gray'],
};

export function catIcon(cat, size = '') {
  const [ic, color] = CAT_STYLE[cat] || CAT_STYLE.other;
  return `<span class="cat-ic c-${color} ${size}">${icon(ic)}</span>`;
}

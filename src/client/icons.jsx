// Значки фишек опасности — одна точка подмены на весь интерфейс.
//
// Ассеты пришли: арты берутся из автогенерируемого манифеста
// (src/client/assets/manifest.js). Где арта нет (id в MISSING) — рисуется
// эмодзи из data.js, чтобы интерфейс не падал. Менять пути руками не нужно:
// правится состав в ассеты/ и `npm run assets`.
//
// Два контекста показа:
//   • HTML (консоль АДЕЛЬ) — <ChipIcon>, отдаёт <img>/<span>;
//   • SVG (карта корабля) — там нужен <image>, а не <img>, поэтому карта берёт
//     URL напрямую через chipSrc() и рисует <image> сама.
import React from 'react';
import { HAZARD_ICON, HAZARD_NAMES } from '../game/data.js';
import { CHIP_ART } from './assets/manifest.js';

export { CHIP_ART };

// URL арта фишки: which = 'chip' (крупный, для карты) | 'chipSmall' (мелкий,
// для ячеек консоли). null, если арта нет — вызвавший откатится на эмодзи.
export function chipSrc(type, which = 'chip') {
  return CHIP_ART[type]?.[which] || null;
}

// Значок вида фишки для HTML. small — брать мелкий арт (ячейки консоли).
// Нет арта → эмодзи из data.js.
export function ChipIcon({ type, small = false, className = '' }) {
  const src = chipSrc(type, small ? 'chipSmall' : 'chip');
  const cls = ('icon ' + className).trim();
  return src
    ? <img className={cls} src={src} alt={HAZARD_NAMES[type]} draggable="false" />
    : <span className={cls} aria-hidden="true">{HAZARD_ICON[type]}</span>;
}

// Рубашка жетона аномалии: отдельная точка подмены. Ассетов аномалий нам не
// давали — остаётся своя рубашка «▩».
export const ANOMALY_ART = { back: null };

export function AnomalyBack({ className = '' }) {
  const cls = ('icon ' + className).trim();
  return ANOMALY_ART.back
    ? <img className={cls} src={ANOMALY_ART.back} alt="жетон аномалии" draggable="false" />
    : <span className={cls} aria-hidden="true">▩</span>;
}

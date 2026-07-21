// Значки фишек и жетонов — одна точка подмены на весь интерфейс.
//
// Сейчас рисуются эмодзи. Когда придут ассеты, менять нужно ТОЛЬКО этот файл:
// положить картинки в src/client/assets/ и вписать их в CHIP_ART — всё
// остальное (консоль, карта корабля, панели) подставит их само, потому что
// ходит сюда, а не берёт эмодзи напрямую.
//
// Про репозиторий: сюда идут только собственные иконки. Оригинальные арты и
// сканы коробки в репозиторий не кладём.
import React from 'react';
import { HAZARD_ICON, HAZARD_NAMES } from '../game/data.js';

// Ключ — вид фишки, значение — импортированная картинка (URL после сборки).
// Пример, когда ассеты появятся:
//   import fire from './assets/fire.svg';
//   export const CHIP_ART = { fire, ... };
export const CHIP_ART = {
  fire: null, hypoxia: null, darkness: null, lockdown: null, spy: null, door: null,
};

// Значок вида фишки. Пока в CHIP_ART пусто — рисуется эмодзи из data.js.
export function ChipIcon({ type, className = '' }) {
  const art = CHIP_ART[type];
  const cls = ('icon ' + className).trim();
  return art
    ? <img className={cls} src={art} alt={HAZARD_NAMES[type]} draggable="false" />
    : <span className={cls} aria-hidden="true">{HAZARD_ICON[type]}</span>;
}

// Рубашка жетона аномалии: то же место подмены, отдельным ключом.
export const ANOMALY_ART = { back: null };

export function AnomalyBack({ className = '' }) {
  const cls = ('icon ' + className).trim();
  return ANOMALY_ART.back
    ? <img className={cls} src={ANOMALY_ART.back} alt="жетон аномалии" draggable="false" />
    : <span className={cls} aria-hidden="true">▩</span>;
}

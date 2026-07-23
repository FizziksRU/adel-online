// Единая карточка предмета экипажа. Одна точка отрисовки для всех мест показа:
// инвентарь, диалог поиска, панель миссий, лаборатория, терминал доставки,
// результат дрона, «под наблюдением».
//
// Три состояния:
//   • faceDown / id==='hidden' → РУБАШКА (своя, в стиле интерфейса — НЕ из
//     ассетов). Чужой скрытый предмет всегда рубашка, карта не утекает.
//   • есть арт в манифесте        → картинка (thumb ~96px / full ~360px) в рамке
//     цвета миссии, у full — название и эффект из data.js.
//   • id есть, но арта нет (MISSING) → текстовый фолбэк, без падения.
//
// size: 'thumb' | 'full'. popover (только у thumb) добавляет всплывающую полную
// карточку по ховеру — как просит инвентарь.
import React from 'react';
import { ITEMS, ITEM_EFFECTS } from '../game/data.js';
import { ITEM_ART } from './assets/manifest.js';

// Склейка классов без пустых кусков и двойных пробелов (иначе не совпадёт в тестах).
const cx = (...xs) => xs.filter(Boolean).join(' ');

// Класс рамки по миссии предмета: у линзы — обе, поэтому m-both.
const missionClass = (id) => {
  const m = ITEMS[id]?.mission;
  return m === 'both' ? 'm-both' : m === 'blue' ? 'm-blue' : m === 'red' ? 'm-red' : '';
};

// Рубашка: своя, в стиле пульта — стальная плашка с янтарным шестиугольником и
// «?». Ассеты рубашек нам не давали, и по правилам их и не должно быть.
function CardBack({ size }) {
  return (
    <span className={`itemcard back ${size}`} aria-label="скрытый предмет" title="Скрытый предмет">
      <span className="ic-hex" aria-hidden="true">?</span>
    </span>
  );
}

// Значки поверх карточки: заряд, доставлено, произвольная пометка.
function Badges({ charge, delivered, note }) {
  return <>
    {delivered && <span className="ic-badge done" title="раскрыт / доставлен">✓</span>}
    {charge != null && <span className="ic-badge charge" title={`заряд ${charge}`}>⚡{charge}</span>}
    {note && <span className="ic-note">{note}</span>}
  </>;
}

export function ItemCard({
  id, size = 'thumb', faceDown = false, charge = null, delivered = false,
  note = null, onClick = null, popover = false, className = '',
}) {
  // Скрытый предмет — всегда рубашка, чем бы ни притворялся id.
  if (faceDown || !id || id === 'hidden') return <CardBack size={size} />;

  const item = ITEMS[id];
  const art = ITEM_ART[id];
  const name = item?.name || '???';
  const mcls = missionClass(id);
  // Кликабельная карточка — ещё и с клавиатуры (Enter/Пробел), а не только мышью.
  const clickable = onClick ? {
    onClick, role: 'button', tabIndex: 0,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } },
  } : {};

  // Фолбэк: предмет известен, но арта нет — текст, не падение.
  if (!art) {
    return (
      <span className={cx('itemcard fallback', size, mcls, className)} title={name} {...clickable}>
        <span className="ic-fbname">{name}</span>
        {size === 'full' && ITEM_EFFECTS[id] && <span className="ic-eff">{ITEM_EFFECTS[id]}</span>}
        <Badges charge={charge} delivered={delivered} note={note} />
      </span>
    );
  }

  if (size === 'full') {
    return (
      <figure className={cx('itemcard full', mcls, className)} {...clickable}>
        <span className="ic-art"><img src={art.card} alt={name} draggable="false" /></span>
        <figcaption>
          <b className="ic-name">{name}</b>
          {ITEM_EFFECTS[id] && <small className="ic-eff">{ITEM_EFFECTS[id]}</small>}
        </figcaption>
        <Badges charge={charge} delivered={delivered} note={note} />
      </figure>
    );
  }

  // thumb: миниатюра. По ховеру (popover) — всплывает полная карточка.
  const thumb = (
    <span className={cx('itemcard thumb', mcls, className)}
      title={ITEM_EFFECTS[id] ? `${name} — ${ITEM_EFFECTS[id]}` : name} {...clickable}>
      <img src={art.thumb} alt={name} draggable="false" />
      <Badges charge={charge} delivered={delivered} note={note} />
    </span>
  );
  if (!popover) return thumb;
  return (
    <span className="ic-wrap">
      {thumb}
      <span className="ic-pop" aria-hidden="true">
        <ItemCard id={id} size="full" charge={charge} delivered={delivered} note={note} />
      </span>
    </span>
  );
}

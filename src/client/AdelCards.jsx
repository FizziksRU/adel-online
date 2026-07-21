// Панель выбранной карты АДЕЛЬ: карты локаций и семь специальных.
// Вынесено из Board.jsx отдельным модулем по двум причинам: панель разрослась
// до трети файла, и её нужно проверять тестом в каждом состоянии выбора —
// компонент принимает выбор пропсом, а не прячет его в своём useState.
import React from 'react';
import {
  ADJ, TERMINALS, HAZARD_NAMES, SECTOR_OF, SPECIAL_REDRAW_MAX, SPECIAL_RECHIP_MAX,
} from '../game/data.js';
import { hazardCardRules, consoleFree, ATTACK_CARD } from '../game/index.js';

const ALL_LOCS = Array.from({ length: 20 }, (_, i) => i + 1);
const countBy = (arr) => arr.reduce((acc, x) => ({ ...acc, [x]: (acc[x] || 0) + 1 }), {});

// Виды фишек, которыми эту карту вообще можно сыграть: нужна и фишка на
// консоли, и хоть одна законная локация. Считается одним кодом и для подсказки
// в панели карты, и для того, какие ячейки консоли станут кликабельными, —
// иначе панель и консоль разошлись бы в том, что доступно.
export function availableTypes(G, rules) {
  if (!rules) return [];
  return rules.types.filter(hz => G.adel.console[hz]?.length && ALL_LOCS.some(l => rules.allowed(l, hz)));
}

// Цена выкладывания этим видом: консольная (самая дорогая фишка вида) плюс
// собственная цена карты — ровно как считает движок.
export const chipPrice = (G, card, rules, hz) =>
  (rules.payConsole ? (G.adel.console[hz]?.at(-1) ?? 0) : 0) + (card.cost || 0);

// Закрытая карта — та, у которой сервер вырезал поля. Так отдаёт состояние
// сервер, который ещё прячет руку АДЕЛЬ; экран от этого падать не должен.
const isFaceDown = (c) => !c || (c.type !== 'loc' && !c.name);

// Подпись карты голым текстом — для атрибута title и для сравнений.
export const cardLabel = (c) => {
  if (isFaceDown(c)) return '▩ закрытая карта';
  return c.type === 'loc' ? `Локации ${c.locs.join(' / ')}` : `★ ${c.name}`;
};

// Номер локации цветом её сектора: по одной цифре видно, куда бьёт карта,
// не сверяясь с картой корабля. Цвета берутся из разбиения на секторы, а не
// вписаны в разметку руками.
export const LocNum = ({ loc }) => <b className={'sect ' + SECTOR_OF[loc]}>{loc}</b>;

// Та же подпись, но с цветными номерами — для показа на экране.
export function CardLabel({ card: c }) {
  if (isFaceDown(c)) return <>▩ закрытая карта</>;
  if (c.type !== 'loc') return <>★ {c.name}</>;
  return <>Локации {c.locs.map((l, i) =>
    <React.Fragment key={i}>{i > 0 ? ' / ' : ''}<LocNum loc={l} /></React.Fragment>)}</>;
}

// Куда уходит выкладывание: обычная карта играется adelPlayCard, а аномалия
// «Атака» — своим ходом. Всё остальное (подбор целей, уточнение двери и
// блокировки) у них общее.
export const placeChip = (moves, card) => (hz, target) => (
  card.id === ATTACK_CARD ? moves.adelAttack(hz, target) : moves.adelPlayCard(card.id, { type: hz, target })
);

// Локация выбрана. У двери и блокировки цель уточняется ещё одним шагом
// (какой проём / компьютер или терминал), остальные фишки кладутся сразу.
export function chooseCardLoc({ moves, setSel, card, hz, loc }) {
  if (hz === 'door' || hz === 'lockdown') setSel({ kind: 'adelCard', card, hz, loc });
  else { placeChip(moves, card)(hz, { loc }); setSel(null); }
}

// Карта, кладущая фишку: вид фишки → законная локация → уточнение цели.
// Законные цели считает hazardCardRules — тот же код, которым ход потом
// проверит движок. Так интерфейс не может предложить отклоняемый ход.
function HazardCard({ G, sel, setSel, moves, rules }) {
  const card = sel.card;
  // Цена в подсказке считается тем же правилом, что и в движке.
  const price = (hz) => chipPrice(G, card, rules, hz);

  if (!sel.hz) {
    const types = availableTypes(G, rules);
    if (types.length === 0) {
      return <p className="error">Нет ни подходящей фишки на консоли, ни законной локации для этой карты.</p>;
    }
    // Сам выбор вида делается на консоли — кликом по занятой ячейке нужного
    // ряда, как на физическом планшете. Здесь остаётся только подсказка с
    // ценами: что почём, по ячейке не прочитать.
    return <>
      <p>Какую фишку выложить? Кликните по занятой ячейке нужного вида на консоли —
        с неё снимется самая дорогая фишка. Доступно:{' '}
        {types.map((hz, i) => <b key={hz}>{i > 0 ? ', ' : ''}{HAZARD_NAMES[hz]} (−{price(hz)}⚡)</b>)}</p>
    </>;
  }

  if (sel.loc == null) {
    const locs = ALL_LOCS.filter(l => rules.allowed(l, sel.hz));
    return <>
      <p>«{HAZARD_NAMES[sel.hz]}» за {price(sel.hz)}⚡ — в какую локацию? Можно кликнуть по карте.</p>
      {locs.map(l => <button key={l}
        onClick={() => chooseCardLoc({ moves, setSel, card, hz: sel.hz, loc: l })}>Локация <LocNum loc={l} /></button>)}
      <button onClick={() => setSel({ kind: 'adelCard', card })}>← другая фишка</button>
    </>;
  }

  const place = (target) => { placeChip(moves, card)(sel.hz, target); setSel(null); };
  if (sel.hz === 'door') return <>
    <p>Какой проём заблокировать из локации {sel.loc}?</p>
    {ADJ[sel.loc].map(nb => <button key={nb} onClick={() => place({ loc: sel.loc, door: nb })}>
      Дверь <LocNum loc={sel.loc} />↔<LocNum loc={nb} /></button>)}
  </>;
  return <>
    <p>Что заблокировать в локации {sel.loc}?</p>
    {['computer', ...(TERMINALS[sel.loc] ? ['terminal'] : [])].map(slot =>
      <button key={slot} onClick={() => place({ loc: sel.loc, slot })}>
        {slot === 'terminal' ? 'Терминал' : 'Компьютер'}</button>)}
  </>;
}

// «Восстановление данных» — карта из сброса на верх колоды.
function RecallCard({ G, play }) {
  const A = G.adel;
  if (!A.discard.length) return <p className="error">Сброс пуст — возвращать нечего.</p>;
  return <>
    <p>Какую карту вернуть на верх колоды?</p>
    {A.discard.map((c, i) => <button key={i} onClick={() => play({ cardId: c.id })}><CardLabel card={c} /></button>)}
  </>;
}

// «Пересборка руки» — сбросить эту карту и до трёх других, взять столько же.
function RedrawCard({ G, sel, setSel, play, paid }) {
  const picked = sel.picked || [];
  const others = G.adel.hand.filter(c => c.id !== sel.card.id);
  const toggle = (id) => setSel({
    ...sel, picked: picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id],
  });
  return <>
    <p>Отметьте до {SPECIAL_REDRAW_MAX} карт с руки на сброс (отмечено {picked.length}).
      Сама карта сбрасывается всегда.</p>
    {others.map(c => <button key={c.id} className={picked.includes(c.id) ? 'sel' : ''}
      disabled={!picked.includes(c.id) && picked.length >= SPECIAL_REDRAW_MAX}
      onClick={() => toggle(c.id)}><CardLabel card={c} /></button>)}
    <button className="primary" onClick={() => play({ cardIds: picked })}>
      Сбросить {picked.length + 1} и взять столько же{paid}</button>
  </>;
}

// «Дефрагментация» — до трёх фишек из сброса обратно на консоль.
function RechipCard({ G, sel, setSel, play, paid }) {
  const picked = sel.picked || [];
  const have = countBy(G.adel.chipDiscard);
  const taken = countBy(picked);
  // Кроме запаса в сбросе учитываем свободные ячейки консоли: движок
  // отклоняет возврат целиком, если класть уже некуда.
  const left = (t) => have[t] - (taken[t] || 0);
  const cells = (t) => consoleFree(G, t) - (taken[t] || 0);
  const canAdd = (t) => picked.length < SPECIAL_RECHIP_MAX && left(t) > 0 && cells(t) > 0;
  return <>
    <p>Верните до {SPECIAL_RECHIP_MAX} фишек из сброса на консоль (отмечено {picked.length}).</p>
    {Object.keys(have).map(t => <button key={t} disabled={!canAdd(t)}
      onClick={() => setSel({ ...sel, picked: [...picked, t] })}>
      + {HAZARD_NAMES[t]} · в сбросе {left(t)}, свободных ячеек {cells(t)}</button>)}
    {picked.length > 0 && <button onClick={() => setSel({ ...sel, picked: [] })}>Снять отметки</button>}
    <button className="primary" disabled={picked.length === 0} onClick={() => play({ chips: picked })}>
      Вернуть: {picked.map(t => HAZARD_NAMES[t]).join(', ') || '—'}{paid}</button>
  </>;
}

function SpecialCard({ G, sel, setSel, moves }) {
  const card = sel.card;
  const play = (payload) => { moves.adelPlayCard(card.id, payload); setSel(null); };
  const paid = card.cost ? ` (−${card.cost}⚡)` : '';

  switch (card.id) {
    case 'S_energy':
    case 'S_reshuffle':
      return <button className="primary" onClick={() => play({})}>Применить{paid}</button>;
    case 'S_recall':
      return <RecallCard G={G} play={play} />;
    case 'S_redraw':
      return <RedrawCard G={G} sel={sel} setSel={setSel} play={play} paid={paid} />;
    case 'S_rechip':
      return <RechipCard G={G} sel={sel} setSel={setSel} play={play} paid={paid} />;
    default:
      return <p className="error">Эта карта интерфейсу неизвестна.</p>;
  }
}

export function AdelCardPicker({ G, sel, setSel, moves }) {
  const card = sel.card;
  const rules = hazardCardRules(G, card);
  return (
    <div className="picker">
      <p>{card.type === 'loc' ? `Карта локаций ${card.locs.join(' / ')}` : `★ ${card.name}: ${card.text}`}</p>
      {rules
        ? <HazardCard G={G} sel={sel} setSel={setSel} moves={moves} rules={rules} />
        : <SpecialCard G={G} sel={sel} setSel={setSel} moves={moves} />}
      {card.id !== ATTACK_CARD &&
        <button onClick={() => { moves.adelDiscard([card.id]); setSel(null); }}>Сбросить карту без розыгрыша</button>}
      <button onClick={() => setSel(null)}>Отмена</button>
    </div>
  );
}

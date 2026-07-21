// Панель выбранной карты АДЕЛЬ: карты локаций и семь специальных.
// Вынесено из Board.jsx отдельным модулем по двум причинам: панель разрослась
// до трети файла, и её нужно проверять тестом в каждом состоянии выбора —
// компонент принимает выбор пропсом, а не прячет его в своём useState.
import React from 'react';
import {
  ADJ, TERMINALS, HAZARD_NAMES, SPECIAL_REDRAW_MAX, SPECIAL_RECHIP_MAX,
} from '../game/data.js';
import { hazardCardRules, consoleFree, ATTACK_CARD } from '../game/index.js';

const ALL_LOCS = Array.from({ length: 20 }, (_, i) => i + 1);
const countBy = (arr) => arr.reduce((acc, x) => ({ ...acc, [x]: (acc[x] || 0) + 1 }), {});

// Подпись карты в руке и в сбросе АДЕЛЬ.
export const cardLabel = (c) => (c.type === 'loc' ? `Локации ${c.locs.join(' / ')}` : `★ ${c.name}`);

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
  const A = G.adel, card = sel.card;
  // Цена в подсказке считается тем же правилом, что и в движке.
  const price = (hz) => (rules.payConsole ? (A.console[hz].at(-1) ?? 0) : 0) + (card.cost || 0);

  if (!sel.hz) {
    const types = rules.types.filter(hz => A.console[hz]?.length && ALL_LOCS.some(l => rules.allowed(l, hz)));
    if (types.length === 0) {
      return <p className="error">Нет ни подходящей фишки на консоли, ни законной локации для этой карты.</p>;
    }
    return <>
      <p>Какую фишку выложить? С консоли снимается самая дорогая.</p>
      {types.map(hz => <button key={hz} onClick={() => setSel({ ...sel, hz })}>
        {HAZARD_NAMES[hz]} (−{price(hz)}⚡)</button>)}
    </>;
  }

  if (sel.loc == null) {
    const locs = ALL_LOCS.filter(l => rules.allowed(l, sel.hz));
    return <>
      <p>«{HAZARD_NAMES[sel.hz]}» за {price(sel.hz)}⚡ — в какую локацию? Можно кликнуть по карте.</p>
      {locs.map(l => <button key={l}
        onClick={() => chooseCardLoc({ moves, setSel, card, hz: sel.hz, loc: l })}>Локация {l}</button>)}
      <button onClick={() => setSel({ kind: 'adelCard', card })}>← другая фишка</button>
    </>;
  }

  const place = (target) => { placeChip(moves, card)(sel.hz, target); setSel(null); };
  if (sel.hz === 'door') return <>
    <p>Какой проём заблокировать из локации {sel.loc}?</p>
    {ADJ[sel.loc].map(nb => <button key={nb} onClick={() => place({ loc: sel.loc, door: nb })}>
      Дверь {sel.loc}↔{nb}</button>)}
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
    {A.discard.map(c => <button key={c.id} onClick={() => play({ cardId: c.id })}>{cardLabel(c)}</button>)}
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
      onClick={() => toggle(c.id)}>{cardLabel(c)}</button>)}
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

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ADJ, SECTOR_OF, SECTOR_NAMES, TERMINALS, TERMINAL_NAMES, HATCHES, SPACE_NEAR,
  CHARACTERS, ITEMS, HAZARD_NAMES, HAZARD_ICON, EVENTS, ANOMALIES, ANOMALY_COST, MARKER_SLOTS,
  CONSOLE_COSTS, CONSOLE_LAYOUT, CONSOLE_ORDER,
  ACTION_NAMES, SPACE_SECTIONS, SPACE_NAMES, SPACE_ADJ,
  ADEL_HAND_LIMIT,
} from '../game/data.js';

import { hazardCardRules, ATTACK_CARD } from '../game/index.js';
import { AdelCardPicker, chooseCardLoc, cardLabel } from './AdelCards.jsx';
import { POS, PAD, BOX_W, BOX_H, CELL_X, CELL_Y, xy, gridMax } from './layout.js';

const SECTOR_TINT = { green: '#2f7d4f', yellow: '#b08a1e', grey: '#5d6b78', red: '#a33b3b', blue: '#3763a8' };
const ACTION_LABELS = ACTION_NAMES;

// Псевдокарта аномалии «Атака»: панель выбора цели у неё общая с картами.
const ATTACK_CARD_UI = { id: ATTACK_CARD, type: 'special', name: 'Атака', cost: 0,
  text: 'Выложите фишку в локацию цвета текущего события. Оплата — по консоли.' };

// Человеческие названия ходов — для сообщения об отклонённом ходе.
const MOVE_NAMES = {
  commitPlan: 'закрыть ширму', actMove: 'движение', actSearch: 'поиск',
  actActivate: 'активация предмета', actOpenDoor: 'открыть дверь',
  actSpecial: 'специальное действие', dropItem: 'сбросить предмет',
  payHypoxia: 'отдать кубик', claimActive: 'начать ход', finishTurn: 'завершить действия',
  giveItem: 'передать предмет', shareInfo: 'показать маркеры', droneLook: 'дрон',
  useBattery: 'батарея', pickLab: 'взять из лаборатории', applyMedkit: 'аптечка',
  leaveItem: 'оставить предмет',
  adelPlayCard: 'сыграть карту', adelDiscard: 'сбросить карту',
  adelActivateAnomaly: 'активировать аномалию', adelAttack: 'атака',
  adelSpyMarker: 'шпионаж', adelEndPhase: 'завершить фазу', adelEndEvent: 'закрыть окно атаки',
};

// Все фишки АДЕЛЬ, лежащие сейчас на поле, — из них оплачивается аномалия.
// Дверь на стыке секторов годится за любой из двух цветов.
function boardChips(G) {
  const out = [];
  for (let l = 1; l <= 20; l++) {
    const L = G.board[l];
    for (const h of ['fire', 'hypoxia', 'darkness', 'spy']) {
      if (L.hazards[h]) out.push({ id: `${h}:${l}`, loc: l, type: h, colors: [SECTOR_OF[l]], label: `${HAZARD_NAMES[h]} · лок. ${l}` });
    }
    if (L.computerLocked) out.push({ id: `lockdown:${l}:computer`, loc: l, type: 'lockdown', slot: 'computer', colors: [SECTOR_OF[l]], label: `Блокировка компьютера · лок. ${l}` });
    if (L.terminalLocked) out.push({ id: `lockdown:${l}:terminal`, loc: l, type: 'lockdown', slot: 'terminal', colors: [SECTOR_OF[l]], label: `Блокировка терминала · лок. ${l}` });
    for (const d of L.doors) {
      out.push({ id: `door:${Math.min(l, d)}-${Math.max(l, d)}`, loc: l, type: 'door', door: d, colors: [SECTOR_OF[l], SECTOR_OF[d]], label: `Дверь ${l}↔${d}` });
    }
  }
  return out;
}

// Какие цвета аномалии ещё не закрыты уже выбранными фишками.
function remainingColors(anomaly, pays) {
  const need = [...ANOMALIES[anomaly].colors];
  for (const p of pays) {
    const i = need.findIndex(c => p.colors.includes(c));
    if (i >= 0) need.splice(i, 1);
  }
  return need;
}

// Одна колонка консоли АДЕЛЬ сверху вниз: ячейки нужного вида, занятые —
// снизу (новые фишки ложатся в самые дешёвые, снимаются самые дорогие).
function consoleColumn(A, cost) {
  const cells = [];
  for (const h of CONSOLE_ORDER) {
    const capacity = CONSOLE_LAYOUT[cost]?.[h] || 0;
    const filled = (A.console[h] || []).filter(c => c === cost).length;
    for (let i = 0; i < capacity; i++) cells.push({ type: h, on: i < filled });
  }
  return cells.reverse();
}

export function Board({ G, ctx, moves: rawMoves, playerID }) {
  const me = playerID;
  const isAdel = me === '0';
  const myP = !isAdel ? G.players[me] : null;
  const [sel, setSel] = useState(null);        // текущее «ожидание клика по карте»
  const [plan, setPlan] = useState({ move: 2, search: 1, activate: 0, special: 0, door: 1 });
  const [msg, setMsg] = useState('');
  const active = G.activeCrew === me;

  // Таймеры всплывающего сообщения снимаем при размонтировании: иначе React
  // ругается на обновление состояния у исчезнувшего компонента.
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
  const say = (m) => { setMsg(m); later(() => setMsg(''), 4000); };

  // Обёртка над ходами. Движок отвергает недопустимый ход молча: boardgame.io
  // откатывает состояние, и игрок видит только «кнопка не работает». Сравниваем
  // состояние до и после — если объект G не сменился, ход отклонён.
  // Проверять причину на клиенте нельзя: он видит отфильтрованное состояние,
  // поэтому сообщение общее, а подробности приходят в личный журнал.
  const gRef = useRef(G);
  gRef.current = G;
  const moves = useMemo(() => new Proxy({}, {
    get: (_, name) => (...args) => {
      const before = gRef.current;
      const result = rawMoves[name](...args);
      later(() => {
        if (gRef.current === before) say(`Ход «${MOVE_NAMES[name] || name}» отклонён правилами.`);
      }, 300);
      return result;
    },
  }), [rawMoves]);

  const planTotal = Object.values(plan).reduce((a, b) => a + b, 0);

  // ---- клик по локации на карте: маршрутизация по текущему выбору ----
  const clickLoc = (l) => {
    if (!sel) return;
    const done = () => setSel(null);
    switch (sel.kind) {
      case 'move': moves.actMove(l); done(); break;
      case 'openDoor': moves.actOpenDoor(l); done(); break;
      case 'clearHazard': moves.actSpecial({ kind: 'clearHazard', hazard: sel.hazard, loc: l, risky: sel.risky }); done(); break;
      case 'repairTerminal': moves.actSpecial({ kind: 'terminal', loc: l, risky: sel.risky }); done(); break;
      case 'centralUnlock': moves.actSpecial({ kind: 'terminal', loc: l, slot: sel.slot, risky: sel.risky }); done(); break;
      case 'repairFromSpace': moves.actSpecial({ kind: 'repairFromSpace', loc: l, risky: sel.risky }); done(); break;
      case 'droneLook': moves.droneLook(l); done(); break;
      // Карта АДЕЛЬ: кликом выбирается локация, но только после выбора вида
      // фишки и только если она законна по тем же правилам, что и в движке.
      case 'adelCard': {
        if (!sel.hz) break;
        const rules = hazardCardRules(G, sel.card);
        if (!rules?.allowed(l, sel.hz)) break;
        chooseCardLoc({ moves, setSel, card: sel.card, hz: sel.hz, loc: l });
        break;
      }
      default: break;
    }
  };

  const hazBtn = (l) => {
    const L = G.board[l];
    const chips = [];
    for (const h of ['fire', 'hypoxia', 'darkness', 'spy']) if (L.hazards[h]) chips.push(HAZARD_ICON[h]);
    if (L.computerLocked) chips.push(HAZARD_ICON.lockdown);
    if (L.terminalLocked) chips.push('⛔');
    if (L.damage) chips.push('💥');
    if (L.hatchClosed) chips.push('🚪');
    return chips.join(' ');
  };

  // ---------- SVG-карта ----------
  const mapW = PAD * 2 + gridMax(0) * CELL_X + BOX_W;
  const mapH = PAD * 2 + gridMax(1) * CELL_Y + BOX_H;
  const doorLines = [];
  for (const [a, nbs] of Object.entries(ADJ)) {
    for (const b of nbs) {
      if (+a < b) {
        const [x1, y1] = xy(+a), [x2, y2] = xy(b);
        const blocked = G.board[a].doors.includes(b) || G.board[b].doors.includes(+a);
        doorLines.push(
          <line key={`${a}-${b}`}
            x1={x1 + BOX_W / 2} y1={y1 + BOX_H / 2} x2={x2 + BOX_W / 2} y2={y2 + BOX_H / 2}
            className={blocked ? 'door blocked' : 'door'} />,
        );
      }
    }
  }

  const crewHere = (l) => Object.entries(G.players).filter(([, p]) => !p.inSpace && !p.dead && p.pos === l);

  // ---------- панели ----------
  const renderPlanning = () => {
    if (myP.committed) return <div className="panel"><h3>Планирование</h3><p>Ждём остальных членов экипажа…</p></div>;
    return (
      <div className="panel">
        <h3>Планирование · 4 кубика</h3>
        {Object.keys(ACTION_LABELS).map(k => (
          <div className="planrow" key={k}>
            <span>{ACTION_LABELS[k]}</span>
            <div>
              <button onClick={() => setPlan(p => ({ ...p, [k]: Math.max(0, p[k] - 1) }))}>−</button>
              <b>{plan[k]}</b>
              <button onClick={() => setPlan(p => ({ ...p, [k]: p[k] + 1 }))}>+</button>
            </div>
          </div>
        ))}
        <p className={planTotal === 4 ? 'ok' : 'error'}>Всего: {planTotal} / 4</p>
        <button className="primary" disabled={planTotal !== 4} onClick={() => moves.commitPlan(plan)}>
          Закрыть ширму
        </button>
      </div>
    );
  };

  const cubesLeft = (k) => myP?.plan ? myP.plan[k] - myP.plan.spent[k] : 0;

  const specialBtn = (label, mkSel, opts = {}) => (
    <div className="specialrow" key={label}>
      <span>{label}</span>
      <span>
        <button onClick={() => mkSel(false)}>3⬛</button>
        {CHARACTERS[myP.character].special !== 'cheap_special' &&
          <button onClick={() => mkSel(true)} title="2 кубика + проверка духа">2⬛+🎲</button>}
      </span>
    </div>
  );

  // Долг по сбросу может свалиться и на неактивного игрока: например, ему
  // передали предмет терминалом доставки. Пока он не разберётся, ход команды
  // не закончится, поэтому панель показывается вне очереди.
  const renderDropOnly = () => (
    <div className="panel picker">
      <h3>Перегруз инвентаря</h3>
      <p className="error">Сбросьте {myP.pendingDrop} предмет(а) — иначе ход команды не завершится.</p>
      <div className="btns">
        {myP.inventory.map((it, i) =>
          <button key={i} onClick={() => moves.dropItem(i)}>Сбросить: {ITEMS[it.id]?.name || '???'}</button>)}
      </div>
    </div>
  );

  const renderActions = () => {
    const P = myP;
    if (!P.acted && !active && !G.activeCrew) {
      return <div className="panel"><h3>Фаза действий</h3>
        <button className="primary" onClick={() => moves.claimActive()}>Я хожу</button>
        <p className="hint">Команда сама решает порядок. Активный игрок завершает все действия прежде, чем ход перейдёт дальше.</p>
      </div>;
    }
    if (!active) return <div className="panel"><h3>Фаза действий</h3><p>{G.activeCrew ? `Действует ${CHARACTERS[G.players[G.activeCrew].character].name}…` : P.acted ? 'Вы завершили действия.' : ''}</p></div>;

    const term = !P.inSpace && TERMINALS[P.pos];
    const isAlarm = !P.inSpace && G.alarmTerminals.includes(P.pos);
    const here = P.inSpace ? [] : crewHere(P.pos).filter(([pid]) => pid !== me);

    return (
      <div className="panel">
        <h3>Ваш ход · {P.inSpace ? `космос: ${SPACE_NAMES[P.inSpace]}` : `локация ${P.pos}`}</h3>
        <div className="cubes">
          {Object.keys(ACTION_LABELS).map(k => <span key={k} className="cube">{ACTION_LABELS[k]}: <b>{cubesLeft(k)}</b></span>)}
          {P.bonusCubes > 0 && <span className="cube bonus">Стим: <b>{P.bonusCubes}</b></span>}
        </div>

        {P.pendingLabPick && <div className="picker">
          <p>Выберите предмет из лаборатории (тайно):</p>
          {/* состав приходит массивом только тому, кто сейчас выбирает */}
          {Array.isArray(G.labStack) && G.labStack.map((id, i) =>
            <button key={i} onClick={() => moves.pickLab(id)}>{ITEMS[id].name}</button>)}
        </div>}
        {P.pendingDrop > 0 && <div className="picker">
          <p className="error">Перегруз: сбросьте {P.pendingDrop} предмет(а). Пока не сбросите, ход не продолжится.</p>
          {P.inventory.map((it, i) =>
            <button key={i} onClick={() => moves.dropItem(i)}>Сбросить: {ITEMS[it.id]?.name || '???'}</button>)}
        </div>}
        {P.pendingMedkit > 0 && <div className="picker">
          <p>Аптечка: осталось {P.pendingMedkit} лечения</p>
          <button onClick={() => moves.applyMedkit(me, 1)}>Лечить себя (1)</button>
          {here.map(([pid, p]) => <button key={pid} onClick={() => moves.applyMedkit(pid, 1)}>Лечить {CHARACTERS[p.character].name} (1)</button>)}
        </div>}

        <div className="btns">
          <button disabled={cubesLeft('move') + P.bonusCubes < 1} onClick={() => setSel({ kind: 'move' })}>🚶 Движение → клик по локации</button>
          {!P.inSpace && HATCHES[P.pos] && HATCHES[P.pos].map(s =>
            <button key={s} onClick={() => moves.actMove(s)}>🛰 В космос → {SPACE_NAMES[s]}</button>)}
          {P.inSpace && <>
            {SPACE_ADJ[P.inSpace].map(sec =>
              <button key={sec} onClick={() => moves.actMove(sec)}>🛰 Соседняя секция → {SPACE_NAMES[sec]}</button>)}
            {Object.entries(HATCHES).filter(([, ss]) => ss.includes(P.inSpace)).map(([l]) =>
              <button key={l} onClick={() => moves.actMove(+l)}>🛬 Вернуться в локацию {l}</button>)}
          </>}
          <button disabled={cubesLeft('search') + P.bonusCubes < 1 || P.inSpace || P.pendingTake === P.pos}
            onClick={() => moves.actSearch(false)}>🔍 Поиск (осмотреть локацию)</button>
        </div>

        {/* Что лежит в локации: пока не обыскали — «▩», после осмотра — имена.
            Раньше результат поиска был виден только по подписи кнопки «забрать»
            и мелким буквам на схеме, и его легко было не заметить. */}
        {!P.inSpace && P.pendingTake !== P.pos && <p className="found">
          {G.board[P.pos].items.length === 0
            ? 'В этой локации ничего не лежит.'
            : <>Здесь лежит: {G.board[P.pos].items.map((it, i) =>
              <b key={i}>{i > 0 ? ', ' : ''}{it.faceUp || it.known ? (ITEMS[it.id]?.name ?? '?') : '▩ не осмотрено'}</b>)}</>}
        </p>}

        {/* Осмотр и взятие — одно действие поиска: кубик уже потрачен, и
            решение «брать или оставить» ничего больше не стоит. */}
        {!P.inSpace && P.pendingTake === P.pos && <div className="picker">
          <p>Осмотрели локацию {P.pos}. Забрать предмет? Кубик уже потрачен — решение входит в то же действие.</p>
          {G.board[P.pos].items.map((it, i) =>
            <button key={i} onClick={() => moves.actSearch(i)}>Взять: {ITEMS[it.id]?.name || '???'}</button>)}
          <button onClick={() => moves.leaveItem()}>Оставить на месте</button>
        </div>}

        <div className="btns">
          <button disabled={cubesLeft('door') + P.bonusCubes < 1} onClick={() => setSel({ kind: 'openDoor' })}>🚪 Открыть дверь → клик по соседней локации</button>
        </div>

        <h4>Инвентарь ({P.inventory.length}/{4 - P.invBlocked})</h4>
        <div className="inv">
          {P.inventory.map((it, i) => (
            <div className="item" key={i}>
              <span>{ITEMS[it.id]?.name || '???'}{it.faceUp && it.charge != null ? ` ⚡${it.charge}` : ''}{it.faceUp ? ' ✓' : ''}</span>
              {!it.faceUp && ITEMS[it.id]?.kind !== 'key' &&
                <button disabled={cubesLeft('activate') + P.bonusCubes < 1} onClick={() => moves.actActivate(i)}>Активировать</button>}
              {here.length > 0 && here.map(([pid, p]) =>
                <button key={pid} onClick={() => moves.giveItem(pid, i)}>→ {CHARACTERS[p.character].name}</button>)}
            </div>
          ))}
          {P.inventory.some(it => it.id === 'battery' && it.faceUp && it.charge > 0) && <>
            <button onClick={() => moves.useBattery('computer')}>🔋 Батарея: снять блокировку компьютера</button>
            <button onClick={() => moves.useBattery('terminal')}>🔋 Батарея: снять блокировку терминала</button>
            {G.alarmOff.includes(P.pos) && <button onClick={() => moves.useBattery('alarmFix')}>🔋 Батарея: починить терминал тревоги</button>}
          </>}
          {P.inventory.some(it => it.id === 'drone' && it.faceUp && it.charge > 0) &&
            <button onClick={() => setSel({ kind: 'droneLook' })}>🛸 Дрон: посмотреть предмет → клик по локации</button>}
        </div>

        <h4>Специальное действие</h4>
        {P.inventory.filter(it => ITEMS[it.id]?.kind === 'key').map((it) =>
          specialBtn(`Доставить: ${ITEMS[it.id].name}`, (risky) => moves.actSpecial({ kind: 'deliver', itemId: it.id, risky })))}
        {!P.inSpace && ['spy', 'hypoxia', 'darkness'].map(h =>
          specialBtn(`Убрать «${HAZARD_NAMES[h]}» (своя/соседняя)`, (risky) => setSel({ kind: 'clearHazard', hazard: h, risky })))}
        {term === 'medical' && specialBtn('Мед. терминал: вылечить все раны', (risky) => moves.actSpecial({ kind: 'terminal', risky }))}
        {term === 'command' && specialBtn('Командный: точка невозврата −1', (risky) => moves.actSpecial({ kind: 'terminal', risky }))}
        {term === 'repair' && specialBtn('Ремонтный: убрать повреждение', (risky) => setSel({ kind: 'repairTerminal', risky }))}
        {term === 'engineering' && specialBtn('Инженерный: взять из лаборатории', (risky) => moves.actSpecial({ kind: 'terminal', risky }))}
        {term === 'central' && <>
          {specialBtn('Центральный: снять блокировку (компьютер)', (risky) => setSel({ kind: 'centralUnlock', slot: 'computer', risky }))}
          {specialBtn('Центральный: снять блокировку (терминал)', (risky) => setSel({ kind: 'centralUnlock', slot: 'terminal', risky }))}
          {G.alarmOff.map(l => specialBtn(`Центральный: починить терминал тревоги (лок. ${l})`, (risky) => moves.actSpecial({ kind: 'terminal', fixAlarm: true, loc: l, risky })))}
        </>}
        {term === 'delivery' && Object.entries(G.players).filter(([pid, p]) => pid !== me && !p.dead && !p.inSpace).map(([pid, p]) => <React.Fragment key={pid}>
          {P.inventory.map((it, i) =>
            specialBtn(`Доставка: «${ITEMS[it.id]?.name}» → ${CHARACTERS[p.character].name}`,
              (risky) => moves.actSpecial({ kind: 'terminal', targetPid: pid, invIndex: i, direction: 'give', risky })))}
          {/* «Забрать» требует согласия владельца — по правилам оно даётся голосом */}
          {p.inventory.map((it, i) =>
            specialBtn(`Доставка: забрать «${it.id === 'hidden' ? 'предмет ' + (i + 1) : ITEMS[it.id]?.name}» у ${CHARACTERS[p.character].name} (с согласия)`,
              (risky) => moves.actSpecial({ kind: 'terminal', targetPid: pid, invIndex: i, direction: 'take', consented: true, risky })))}
        </React.Fragment>)}
        {isAlarm && specialBtn('⏰ Терминал тревоги: отменить след. событие', (risky) => moves.actSpecial({ kind: 'terminal', alarm: true, risky }))}
        {!P.inSpace && G.board[P.pos].hatchClosed && specialBtn('Открыть люк здесь', (risky) => moves.actSpecial({ kind: 'openHatch', risky }))}
        {P.inSpace && <>
          {Object.entries(HATCHES).filter(([, ss]) => ss.includes(P.inSpace)).filter(([l]) => G.board[l].hatchClosed).map(([l]) =>
            specialBtn(`Открыть люк локации ${l}`, (risky) => moves.actSpecial({ kind: 'openHatch', loc: +l, risky })))}
          {(SPACE_NEAR[P.inSpace] || []).filter(l => G.board[l].damage).length > 0 &&
            specialBtn('Убрать повреждение (снаружи)', (risky) => setSel({ kind: 'repairFromSpace', risky }))}
        </>}

        {here.length > 0 && <>
          <h4>Обмен информацией</h4>
          {here.map(([pid, p]) => <div key={pid}>
            <button onClick={() => moves.shareInfo(pid, true)}>👁 Показать мои маркеры/предметы: {CHARACTERS[p.character].name}</button>
          </div>)}
        </>}

        <button className="primary finish" onClick={() => { moves.finishTurn(); setSel(null); }}>Завершить действия</button>
      </div>
    );
  };

  const renderAdel = () => {
    const A = G.adel;
    const phaseAdel = G.phase === 'adel';
    return (
      <div className="panel adel">
        <h3>Консоль АДЕЛЬ · ⚡ {A.energy}</h3>
        <div className="console">
          {CONSOLE_COSTS.map(cost => (
            <div className="concol" key={cost}>
              <div className="cells">
                {consoleColumn(A, cost).map((cell, i) => (
                  <i key={i} className={cell.on ? 'chip on' : 'chip'}
                    title={`${HAZARD_NAMES[cell.type]} — ${cost}⚡${cell.on ? '' : ' (пусто)'}`}>
                    {HAZARD_ICON[cell.type]}
                  </i>
                ))}
              </div>
              <span className="concost">{cost}⚡</span>
            </div>
          ))}
        </div>
        <p className="hint">Мешочек: {typeof A.bag === 'number' ? A.bag : Object.values(A.bag).reduce((a, b) => a + b, 0)} фишек · Колода: {A.deck} · Сброс фишек: {A.chipDiscard.length}</p>

        {isAdel && <>
          <h4>Рука ({A.hand.length}/{ADEL_HAND_LIMIT})</h4>
          <div className="btns">
            {A.hand.map(c => (
              <button key={c.id} className={sel?.card?.id === c.id ? 'sel' : ''} disabled={!phaseAdel}
                onClick={() => setSel({ kind: 'adelCard', card: c })}
                title={c.type === 'special' ? c.text : 'Карта локаций'}>
                {cardLabel(c)}
              </button>
            ))}
          </div>
          {sel?.kind === 'adelCard' &&
            <AdelCardPicker G={G} sel={sel} setSel={setSel} moves={moves} />}

          <h4>Аномалии</h4>
          <div className="btns">
            {A.anomalies.map((a, i) => a === 'hidden' ? <button key={i} disabled>▩ скрыта</button> :
              G.anomaliesActive.includes(a) ? <button key={i} disabled>✓ {ANOMALIES[a].name}</button> :
                <button key={i} disabled={!phaseAdel || A.energy < ANOMALY_COST}
                  onClick={() => setSel({ kind: 'anomalyPay', anomaly: a, pays: [], payType: null })}>
                  {ANOMALIES[a].name} · {ANOMALY_COST}⚡ + фишки: {ANOMALIES[a].colors.map(c => SECTOR_NAMES[c]).join(', ')}
                </button>)}
          </div>
          {sel?.kind === 'anomalyPay' && (() => {
            const need = remainingColors(sel.anomaly, sel.pays);
            const chosen = new Set(sel.pays.map(p => p.id));
            const options = boardChips(G).filter(c => !chosen.has(c.id) && c.colors.some(col => need.includes(col)));
            const pick = (chip) => {
              const pays = [...sel.pays, chip];
              if (pays.length < ANOMALIES[sel.anomaly].colors.length) { setSel({ ...sel, pays }); return; }
              moves.adelActivateAnomaly(sel.anomaly,
                pays.map(p => ({ loc: p.loc, type: p.type, door: p.door, slot: p.slot })));
              setSel(null);
            };
            return <div className="picker">
              <p>«{ANOMALIES[sel.anomaly].name}» · {ANOMALY_COST}⚡ — снимите с поля по фишке из секторов:{' '}
                {need.map(c => <i key={c} className={'hex ' + c} title={SECTOR_NAMES[c]} />)}
                {sel.pays.length > 0 && <> · выбрано: {sel.pays.map(p => p.label).join(', ')}</>}</p>
              {options.length === 0
                ? <p className="error">На поле нет фишек нужных цветов — аномалию пока не активировать.</p>
                : options.map(c => <button key={c.id} onClick={() => pick(c)}>
                  {c.label} {c.colors.map(col => <i key={col} className={'hex ' + col} title={SECTOR_NAMES[col]} />)}
                </button>)}
              <button onClick={() => setSel(null)}>Отмена</button>
            </div>;
          })()}

          {/* «Атака» разыгрывается в окне фазы событий — до того, как экипаж
              распределит кубики. Выбор цели идёт тем же пикером, что и у карт,
              поэтому доступны и дверь, и выбор компьютер/терминал. */}
          {G.anomaliesActive.includes('attack') && <div className="btns">
            <button disabled={G.phase !== 'event' || G.attackUsedThisTurn}
              onClick={() => setSel({ kind: 'adelCard', card: ATTACK_CARD_UI })}>
              ⚔ Атака: фишка в сектор цвета события ({SECTOR_NAMES[G.currentEvent.color]})
            </button>
          </div>}
          {G.phase === 'event' && <button className="primary finish" onClick={() => { moves.adelEndEvent(); setSel(null); }}>
            Закрыть окно атаки — экипаж планирует
          </button>}

          <h4>Шпионаж</h4>
          <div className="btns">
            {Object.entries(G.players).filter(([, p]) => !p.inSpace && !p.dead && G.board[p.pos]?.hazards.spy).map(([pid, p]) =>
              MARKER_SLOTS.filter(s => G.missions.viewers[s].includes(pid)).map(s =>
                <button key={pid + s} onClick={() => moves.adelSpyMarker(pid, s)}>
                  👁 {CHARACTERS[p.character].name}: маркер «{ITEMS[s].name}» (50/50)</button>))}
          </div>
          {A.spyNotes.length > 0 && <div className="notes">
            {A.spyNotes.map((n, i) => <p key={i}>Ход {n.turn}: «{ITEMS[n.slot].name}» → {n.value === 'X' ? '✖ (возможно, пустышка)' : `локация ${n.value}`}</p>)}
          </div>}

          {phaseAdel && <button className="primary finish" onClick={() => { moves.adelEndPhase(); setSel(null); }}>
            Завершить фазу АДЕЛЬ (добор + энергия)
          </button>}
        </>}
      </div>
    );
  };

  // Гипоксия отнимает кубик действия, но какой именно — решает игрок.
  // Панель показывается и вне своего хода: опасность срабатывает в розыгрыше.
  const renderHypoxia = () => (
    <div className="panel picker">
      <h3>🫁 Гипоксия</h3>
      <p>Отдайте в запас неиспользованный кубик действия{myP.pendingHypoxia > 1 ? ` (осталось отдать: ${myP.pendingHypoxia})` : ''}:</p>
      <div className="btns">
        {Object.keys(ACTION_LABELS).filter(k => cubesLeft(k) > 0).map(k =>
          <button key={k} onClick={() => moves.payHypoxia(k)}>{ACTION_LABELS[k]} ({cubesLeft(k)})</button>)}
      </div>
    </div>
  );

  const renderMissions = () => {
    // Красная миссия закрыта, когда точка невозврата обогнала жетон хода.
    const redOut = G.turnNo < G.pointOfNoReturn;
    const damage = Object.values(G.board).filter(L => L.damage).length;
    const done = (id) => G.missions.markers[id]?.revealed;
    const blueLeft = ['blue_card', 'id_badge', 'lens'].filter(id => !done(id)).length;
    const redLeft = ['chipItem', 'toolbox', 'lens'].filter(id => !done(id)).length;
    return (
      <div className="panel missions">
        <h3>Миссии</h3>
        <div className="mrow">
          <span className={'mtag blue' + (blueLeft === 0 && damage === 0 ? ' ready' : '')}>
            СИНЯЯ · отключить АДЕЛЬ · финал: топор → лок. 20<br />
            осталось предметов: {blueLeft} · повреждений на корабле: {damage}
            {blueLeft === 0 && damage === 0 && ' · топор готов'}
          </span>
          <span className={'mtag red' + (redOut ? ' blocked' : (redLeft === 0 ? ' ready' : ''))}>
            КРАСНАЯ · побег · финал: шлем → лок. 16<br />
            осталось предметов: {redLeft} · запас: {G.turnNo - G.pointOfNoReturn}
            {redOut ? ' · ЗАБЛОКИРОВАНА: точка невозврата пройдена' : (redLeft === 0 ? ' · шлем готов' : '')}
          </span>
        </div>
        <div className="markers">
          {MARKER_SLOTS.map(s => {
            const m = G.missions.markers[s];
            const known = m.loc != null;
            // Обводка — цвета той миссии, к которой относится предмет;
            // линза-сетчатка нужна обеим, поэтому у неё своя пометка.
            const mission = ITEMS[s].mission;
            return <div key={s} className={`marker m-${mission}` + (m.revealed ? ' done' : '')}>
              <b>{ITEMS[s].name}</b>
              <span>{m.revealed ? `✅ доставлено (лок. ${m.loc})` : known ? `→ лок. ${m.loc} (видно вам)` : '▩ скрыто'}</span>
              <i>{G.missions.viewers[s].map(v => CHARACTERS[G.players[v]?.character]?.name).join(', ')}</i>
            </div>;
          })}
        </div>
        <p className="hint">Ход: <b>{G.turnNo}</b> · Точка невозврата: <b>{G.pointOfNoReturn}</b>
          {' '}(каждый ход сдвигается на 1, «Дрейф» — на 2)
          {G.anomaliesActive.length > 0 && <> · Аномалии: {G.anomaliesActive.map(a => ANOMALIES[a].name).join(', ')}</>}</p>
      </div>
    );
  };

  const ev = G.currentEvent && EVENTS[G.currentEvent.id];
  const nx = G.nextEvent && EVENTS[G.nextEvent.id];

  return (
    <div className="game">
      <header>
        <div className="logo small">А.Д.Е.Л.Ь.</div>
        <div className="phase">
          {G.winner ? (G.winner === 'crew' ? '🎉 ПОБЕДА ЭКИПАЖА' : '🤖 ПОБЕДА АДЕЛЬ') :
            { event: '⚔ Фаза событий: атака АДЕЛЬ', planning: '📝 Планирование', adel: '🤖 Фаза АДЕЛЬ', actions: '🚀 Фаза действий', reveal: '👀 Розыгрыш', endturn: '⏳ Конец хода' }[G.phase]}
        </div>
        <div className="event">
          {ev && <span className={G.currentEvent.cancelled ? 'cancelled' : ''}>
            Событие: <b>{ev.name}</b> <i className={'hex ' + G.currentEvent.color} title={`цвет: ${SECTOR_NAMES[G.currentEvent.color]}`} />
            {G.currentEvent.panic && <span title="значок паники: сработает одноимённая аномалия">😱</span>} — {ev.text}
          </span>}
          {nx && <span className="next">Далее: {nx.name}
            {G.nextEvent.color && <i className={'hex ' + G.nextEvent.color} title={`цвет: ${SECTOR_NAMES[G.nextEvent.color]}`} />}
            {G.nextEvent.panic && '😱'}{G.nextEvent.cancelled ? ' (отменено)' : ''}</span>}
        </div>
      </header>

      <div className="cols">
        <div className="mapwrap">
          {sel && <div className="selbanner">Выберите цель на карте… <button onClick={() => setSel(null)}>отмена</button></div>}
          {/* viewBox обязателен: без него max-width сжимает рамку, а содержимое
              остаётся 1:1 и обрезается по краю */}
          <svg width={mapW} height={mapH} viewBox={`0 0 ${mapW} ${mapH}`}
            preserveAspectRatio="xMidYMid meet" className="map">
            {doorLines}
            {Object.keys(POS).map(l => {
              const L = G.board[l];
              const [x, y] = xy(+l);
              const here = crewHere(+l);
              return (
                <g key={l} transform={`translate(${x},${y})`} className="locg" onClick={() => clickLoc(+l)}>
                  <rect width={BOX_W} height={BOX_H} rx="10" className="loc"
                    style={{ stroke: SECTOR_TINT[SECTOR_OF[l]] }} />
                  <text x="8" y="16" className="locnum">{l}</text>
                  {TERMINALS[l] && <text x="8" y="30" className="term">{TERMINAL_NAMES[TERMINALS[l]].replace('Терминал ', 'T·').replace(' терминал', '')}</text>}
                  {G.alarmTerminals.includes(+l) && <text x="60" y="16" className="alarm">⏰</text>}
                  {L.items.length > 0 && <text x="8" y="46" className="itm">
                    {L.items.map(it => it.faceUp || it.known ? (ITEMS[it.id]?.name ?? '?') : '▩').join(', ')}
                    <title>{L.items.map(it => it.faceUp || it.known ? (ITEMS[it.id]?.name ?? '?') : 'неизвестный предмет').join(', ')}</title>
                  </text>}
                  <text x="8" y="62" className="hz">{hazBtn(l)}</text>
                  {here.map(([pid, p], i) =>
                    <circle key={pid} cx={74 - i * 14} cy="56" r="7" className={'pawn c' + pid}>
                      <title>{CHARACTERS[p.character].name}</title>
                    </circle>)}
                  {HATCHES[l] && <text x="70" y="34" className="hatch" title="люк">◨</text>}
                </g>
              );
            })}
          </svg>
          <div className="spacebar">
            Открытый космос: {SPACE_SECTIONS.map(s => {
              const who = Object.entries(G.players).filter(([, p]) => p.inSpace === s && !p.dead);
              return <span key={s} className="ssec">{SPACE_NAMES[s]}{who.map(([pid, p]) => <b key={pid}> · {CHARACTERS[p.character].name}</b>)}</span>;
            })}
          </div>
        </div>

        <div className="side">
          {G.winner && <div className="panel winner">{G.winner === 'crew' ? '🎉 Экипаж побеждает!' : '🤖 АДЕЛЬ побеждает.'}</div>}
          {!isAdel && myP && <div className="panel me">
            <h3>{CHARACTERS[myP.character].name} · дух {CHARACTERS[myP.character].spirit}</h3>
            <p>❤ Раны: {myP.health}/5 {myP.dead && '☠'} · Позиция: {myP.inSpace ? `космос, ${SPACE_NAMES[myP.inSpace]}` : myP.pos}</p>
          </div>}
          {/* myP отсутствует у наблюдателя и при чужом playerID — без проверки
              весь экран падал бы на первом же обращении к полям игрока */}
          {!isAdel && !G.winner && myP && !myP.dead && myP.pendingHypoxia > 0 && renderHypoxia()}
          {!isAdel && !G.winner && myP && !myP.dead && myP.pendingDrop > 0 && !active && renderDropOnly()}
          {!isAdel && !G.winner && myP && !myP.dead && G.phase === 'planning' && renderPlanning()}
          {!isAdel && !G.winner && myP && !myP.dead && G.phase === 'actions' && renderActions()}
          {renderAdel()}
          {renderMissions()}
          {!isAdel && G.privateLog?.length > 0 && <div className="panel log private">
            <h3>Только вам</h3>
            <div className="logbody">{[...G.privateLog].reverse().map((l, i) => <p key={i}>{l}</p>)}</div>
          </div>}
          <div className="panel log">
            <h3>Журнал</h3>
            <div className="logbody">{[...G.log].reverse().map((l, i) => <p key={i}>{l}</p>)}</div>
          </div>
          {msg && <div className="toast">{msg}</div>}
        </div>
      </div>
    </div>
  );
}

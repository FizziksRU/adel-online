import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ADJ, SECTOR_OF, SECTOR_NAMES, TERMINALS, TERMINAL_NAMES, HATCHES, SPACE_NEAR,
  CHARACTERS, ITEMS, HAZARDS, HAZARD_NAMES, HAZARD_ICON, EVENTS, ANOMALIES, ANOMALY_COST, MARKER_SLOTS,
  ACTION_NAMES, COST_MOD_NAMES, SPACE_SECTIONS, SPACE_NAMES, SPACE_ADJ,
  ADEL_HAND_LIMIT,
} from '../game/data.js';

import {
  hazardCardRules, ATTACK_CARD, actionCost, clearHazardTargets, computerBlockedWhy,
} from '../game/index.js';
import { AdelCardPicker, chooseCardLoc, cardLabel, CardLabel, LocNum, availableTypes } from './AdelCards.jsx';
import { AdelConsole } from './Console.jsx';
import { ItemCard } from './ItemCard.jsx';
import { ChipIcon, chipSrc } from './icons.jsx';
import { SpiritPrompt, RollOverlay, LastRoll, rollShowPlan } from './SpiritRoll.jsx';
import { HealthTrack, CrewRoster } from './Health.jsx';
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
  shareInfo: 'показать маркеры', droneLook: 'дрон',
  useBattery: 'батарея', pickLab: 'взять из лаборатории', applyMedkit: 'аптечка',
  leaveItem: 'оставить предмет',
  adelPlayCard: 'сыграть карту', adelDiscard: 'сбросить карту',
  adelActivateAnomaly: 'активировать аномалию', adelAttack: 'атака',
  adelSpyMarker: 'шпионаж', adelEndPhase: 'завершить фазу', adelEndEvent: 'закрыть окно атаки',
  rollSpirit: 'бросок кубика',
};

// Уважение к prefers-reduced-motion проверяется здесь, а не только в CSS:
// сама фаза «крутится» прячет подпись, и её нужно пропустить целиком.
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

// Ник из лобби у ПЕРВОГО упоминания персонажа в каждом ходе журнала. Движок
// пишет только имя персонажа (ники — клиентские и публичные), поэтому
// подставляем их здесь, над G.log. Разбор идёт по ходам: на строке-разделителе
// «— ХОД n: …» счётчик упомянутых сбрасывается. Длинные имена матчим первыми,
// чтобы частичное совпадение не поймало чужое имя. Возвращаем строки — React
// экранирует их как текст, поэтому ник из лобби нельзя подсунуть как разметку.
export function annotateLog(lines, players, nickOf) {
  const named = [];
  for (const pid of Object.keys(players)) {
    const name = CHARACTERS[players[pid].character]?.name;
    const nick = nickOf(pid);
    if (name && nick) named.push({ pid, name, nick });
  }
  if (!named.length) return [...lines];
  named.sort((a, b) => b.name.length - a.name.length);
  const seen = new Set();
  return lines.map(line => {
    if (/^— ХОД \d+:/.test(line)) seen.clear();
    let out = line;
    for (const { pid, name, nick } of named) {
      if (seen.has(pid)) continue;
      const i = out.indexOf(name);
      if (i < 0) continue;
      out = out.slice(0, i + name.length) + ` (${nick})` + out.slice(i + name.length);
      seen.add(pid);
    }
    return out;
  });
}

export function Board({ G, ctx, moves: rawMoves, playerID, matchData }) {
  const me = playerID;
  const isAdel = me === '0';
  const myP = !isAdel ? G.players[me] : null;
  // Ник игрока по его seat-id из matchData (boardgame.io отдаёт его в проп).
  // null, если ника нет или matchData не пришёл (наблюдатель, реконнект, тесты).
  const nickOf = (pid) => (matchData?.find(p => String(p.id) === pid)?.name) || null;
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

  // ---- анимация кубика: новый G.lastRoll → оверлей у всех ----
  // Что показывать, решает rollShowPlan (она же и проверяется тестом); здесь
  // остаётся только завести таймеры. Первый рендер ничего не проигрывает —
  // иначе при переподключении заново крутился бы давно сыгранный бросок.
  const seenSeq = useRef(G.lastRoll?.seq || 0);
  const [shown, setShown] = useState(null);     // { roll, spinning } или null
  useEffect(() => {
    const plan = rollShowPlan(G.lastRoll, seenSeq.current, reducedMotion());
    if (!plan) return;
    seenSeq.current = plan.seq;
    setShown({ roll: G.lastRoll, spinning: plan.spin > 0 });
    // Таймеры сверяются с seq: бросков подряд бывает несколько (проверка у
    // всего экипажа), и таймер прошлого не должен гасить чужой оверлей.
    if (plan.spin) {
      later(() => setShown(s => (s?.roll.seq === plan.seq ? { ...s, spinning: false } : s)), plan.spin);
    }
    later(() => setShown(s => (s?.roll.seq === plan.seq ? null : s)), plan.hold);
  }, [G.lastRoll?.seq]);

  // ---- клик по локации на карте: маршрутизация по текущему выбору ----
  const clickLoc = (l) => {
    if (!sel) return;
    const done = () => setSel(null);
    switch (sel.kind) {
      case 'move': moves.actMove(l); done(); break;
      case 'openDoor': moves.actOpenDoor(l); done(); break;
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

  // Значки состояния локации для карты. Фишки опасностей с артом — как {type}
  // (рисуются ассетом-<image>), остальные метки (повреждение, люк, блокировка
  // терминала) — как {emoji}: ассетов для них не давали.
  const hazIcons = (l) => {
    const L = G.board[l];
    const out = [];
    for (const h of ['fire', 'hypoxia', 'darkness', 'spy']) if (L.hazards[h]) out.push({ type: h });
    if (L.computerLocked) out.push({ type: 'lockdown', label: 'блокировка компьютера' });
    if (L.terminalLocked) out.push({ emoji: '⛔', label: 'блокировка терминала' });
    if (L.damage) out.push({ emoji: '💥', label: 'повреждение' });
    if (L.hatchClosed) out.push({ emoji: '🚪', label: 'люк закрыт' });
    return out;
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

  // Расшифровка цены для тултипа: «3 базовых + 1 тьма», а если кубиков не
  // хватает — сколько нужно и сколько есть. Модификаторы приходят из движковой
  // actionCost, поэтому подпись и списание не расходятся.
  const costTip = (c) => c.modifiers.map(m => `${m.n} ${COST_MOD_NAMES[m.key] || m.key}`).join(' + ')
    + (c.can ? '' : ` · нужно кубиков: ${c.need}, есть ${c.have}`);

  // Кнопка обычного действия (движение/поиск/активация/дверь). Цену и
  // доступность считает движковая actionCost — тем же кодом, которым он потом
  // спишет кубики. На кнопке — общее число кубиков, в тултипе — из чего оно
  // сложилось. Раньше эти кнопки цену не показывали и доплату за тьму не
  // считали: кнопка нажималась, ход молча отклонялся.
  const actBtn = (action, label, onClick, extraDisabled = false) => {
    const c = actionCost(G, me, action);
    return <button disabled={extraDisabled || !c.can} title={costTip(c)} onClick={onClick}>
      {label} <b className="price">{c.need}⬛</b></button>;
  };

  // Кнопка спец. действия. Цену и доступность считает движок (actionCost) —
  // тем же кодом, которым он потом проверит ход. На кнопке общее число кубиков
  // («4⬛»), в тултипе расшифровка («3 базовых + 1 тьма»); рискованный вариант
  // добавляет к цене значок кубика. Недоступная кнопка в тултипе называет,
  // чего не хватает.
  const specialBtn = (label, mkSel, opts = {}) => {
    const cheap = CHARACTERS[myP.character].special === 'cheap_special';
    const row = (risky) => {
      const c = actionCost(G, me, 'special', { risky });
      const blocked = opts.why || (c.can ? null : `нужно кубиков: ${c.need}, есть ${c.have}`);
      const price = `${c.need}⬛${risky ? '+🎲' : ''}`;
      const title = costTip(c) + (opts.why ? ` · недоступно: ${opts.why}`
        : (risky ? ' · рискованный: 2 кубика + проверка духа' : ' · без проверки духа'));
      return <button key={risky ? 'r' : 'n'} disabled={!!blocked} title={title}
        onClick={() => mkSel(risky)}>{price}</button>;
    };
    return (
      <div className="specialrow" key={opts.key || label}>
        <span>{opts.icon && <ItemCard id={opts.icon} size="thumb" className="rowicon" />}{label}</span>
        <span>{row(false)}{!cheap && row(true)}</span>
      </div>
    );
  };

  // «Убрать фишку» — цель считает движок. Снять опасность можно только в своей
  // локации (решение владельца), поэтому цель всегда одна (или ни одной) —
  // действие выполняется сразу, без похода на карту.
  const clearHazardBtn = (h) => {
    const targets = clearHazardTargets(G, me, h);   // только своя локация
    const why = computerBlockedWhy(G, me)
      || (targets.length ? null : `здесь нет фишки «${HAZARD_NAMES[h]}»`);
    return specialBtn(`Убрать «${HAZARD_NAMES[h]}»${targets.length ? ` · лок. ${targets[0]}` : ''}`,
      (risky) => moves.actSpecial({ kind: 'clearHazard', hazard: h, loc: targets[0], risky }),
      { why });
  };

  // Постоянная панель инвентаря — всегда под рукой, во всех фазах. Действия с
  // предметами (активация, батарея, дрон) работают только когда идёт твой ход в
  // фазе действий; в остальное время панель информационная.
  const renderInventory = () => {
    const P = myP;
    if (!P) return null;
    const interactive = active && !P.dead && G.phase === 'actions';
    return (
      <div className="panel invpanel">
        <h3>Инвентарь ({P.inventory.length}/{4 - P.invBlocked})</h3>
        {!interactive && <p className="hint">Действия с предметами — в свой ход в фазе действий.</p>}
        <div className="inv">
          {P.inventory.length === 0 && <p className="hint">Пусто.</p>}
          {/* Свой инвентарь известен мне: показываю карточки лицом (миниатюра;
              полная — по ховеру). Заряд и «раскрыт» — значками поверх. */}
          {P.inventory.map((it, i) => (
            <div className="item" key={i}>
              <ItemCard id={it.id} size="thumb" popover
                charge={it.faceUp && it.charge != null ? it.charge : null}
                delivered={!!it.faceUp} />
              {interactive && !it.faceUp && ITEMS[it.id]?.kind !== 'key' &&
                actBtn('activate', 'Активировать', () => moves.actActivate(i))}
            </div>
          ))}
          {interactive && P.inventory.some(it => it.id === 'battery' && it.faceUp && it.charge > 0) && <>
            <button onClick={() => moves.useBattery('computer')}>🔋 Батарея: снять блокировку компьютера</button>
            <button onClick={() => moves.useBattery('terminal')}>🔋 Батарея: снять блокировку терминала</button>
            {G.alarmOff.includes(P.pos) && <button onClick={() => moves.useBattery('alarmFix')}>🔋 Батарея: починить терминал тревоги</button>}
          </>}
          {interactive && P.inventory.some(it => it.id === 'drone' && it.faceUp && it.charge > 0) &&
            <button onClick={() => setSel({ kind: 'droneLook' })}>🛸 Дрон: посмотреть предмет → клик по локации</button>}
        </div>
      </div>
    );
  };

  // Разведка: что игрок знает о содержимом локаций — сюда ложится результат
  // дрона (осмотр удалённой локации) и память об обысканных. knownItems есть
  // только у своего игрока (playerView вырезает чужое), утечки нет.
  const renderScouted = () => {
    const P = myP;
    const entries = Object.entries(P?.knownItems || {}).filter(([, ids]) => ids && ids.length);
    if (!entries.length) return null;
    return (
      <div className="panel scouted">
        <h3>Разведка · предметы</h3>
        <p className="hint">Что вы знаете о содержимом локаций (поиск и дрон слежения).</p>
        <div className="scoutlist">
          {entries.map(([loc, ids]) => (
            <div key={loc} className="scoutloc">
              <b>Лок. {loc}</b>
              <span className="foundcards">{ids.map((id, i) =>
                <ItemCard key={i} id={id} size="thumb" popover />)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

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
          <div className="foundcards">
            {Array.isArray(G.labStack) && G.labStack.map((id, i) =>
              <ItemCard key={i} id={id} size="thumb" popover className="pickable" onClick={() => moves.pickLab(id)} />)}
          </div>
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
          {actBtn('move', '🚶 Движение → клик по локации', () => setSel({ kind: 'move' }))}
          {!P.inSpace && HATCHES[P.pos] && HATCHES[P.pos].map(s =>
            <button key={s} onClick={() => moves.actMove(s)}>🛰 В космос → {SPACE_NAMES[s]}</button>)}
          {P.inSpace && <>
            {SPACE_ADJ[P.inSpace].map(sec =>
              <button key={sec} onClick={() => moves.actMove(sec)}>🛰 Соседняя секция → {SPACE_NAMES[sec]}</button>)}
            {Object.entries(HATCHES).filter(([, ss]) => ss.includes(P.inSpace)).map(([l]) =>
              <button key={l} onClick={() => moves.actMove(+l)}>🛬 Вернуться в локацию {l}</button>)}
          </>}
          {actBtn('search', '🔍 Поиск (осмотреть локацию)', () => moves.actSearch(false),
            !!P.inSpace || P.pendingTake === P.pos)}
        </div>

        {/* Что лежит в локации: пока не обыскали — «▩», после осмотра — имена.
            Раньше результат поиска был виден только по подписи кнопки «забрать»
            и мелким буквам на схеме, и его легко было не заметить. */}
        {!P.inSpace && P.pendingTake !== P.pos && <div className="found">
          {G.board[P.pos].items.length === 0
            ? 'В этой локации ничего не лежит.'
            : <>Здесь лежит: <span className="foundcards">{G.board[P.pos].items.map((it, i) =>
              // осмотренное/известное — карточкой, неосмотренное — рубашкой
              <ItemCard key={i} id={it.faceUp || it.known ? it.id : 'hidden'} size="thumb" popover />)}</span></>}
        </div>}

        {/* Осмотр и взятие — одно действие поиска: кубик уже потрачен, и
            решение «брать или оставить» ничего больше не стоит. Найденное —
            полными карточками; в стопке из нескольких они идут рядом. */}
        {!P.inSpace && P.pendingTake === P.pos && <div className="picker">
          <p>Осмотрели локацию {P.pos}. Забрать предмет? Кубик уже потрачен — решение входит в то же действие. Нажмите на карточку, чтобы взять.</p>
          <div className="foundcards full">
            {G.board[P.pos].items.map((it, i) =>
              <ItemCard key={i} id={it.id} size="full" className="pickable" onClick={() => moves.actSearch(i)} />)}
          </div>
          <button onClick={() => moves.leaveItem()}>Оставить на месте</button>
        </div>}

        <div className="btns">
          {actBtn('door', '🚪 Открыть дверь → клик по соседней локации', () => setSel({ kind: 'openDoor' }))}
        </div>

        {/* Сам инвентарь — в постоянной панели сайдбара (renderInventory),
            видной во всех фазах. Здесь остаются только действия фазы действий. */}
        <h4>Специальное действие</h4>
        {P.inventory.filter(it => ITEMS[it.id]?.kind === 'key').map((it, i) =>
          specialBtn(`Доставить: ${ITEMS[it.id].name}`, (risky) => moves.actSpecial({ kind: 'deliver', itemId: it.id, risky }),
            { icon: it.id, key: `deliver:${it.id}:${i}` }))}
        {!P.inSpace && ['spy', 'hypoxia', 'darkness'].map(h => clearHazardBtn(h))}
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
              (risky) => moves.actSpecial({ kind: 'terminal', targetPid: pid, invIndex: i, direction: 'give', risky }),
              { icon: it.id, key: `give:${pid}:${i}` }))}
          {/* «Забрать» требует согласия владельца — по правилам оно даётся голосом.
              Чужой скрытый предмет приходит как 'hidden' — ItemCard рисует его
              рубашкой, название не утекает. */}
          {p.inventory.map((it, i) =>
            specialBtn(`Доставка: забрать «${it.id === 'hidden' ? 'предмет ' + (i + 1) : ITEMS[it.id]?.name}» у ${CHARACTERS[p.character].name} (с согласия)`,
              (risky) => moves.actSpecial({ kind: 'terminal', targetPid: pid, invIndex: i, direction: 'take', consented: true, risky }),
              { icon: it.id, key: `take:${pid}:${i}` }))}
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

  // ---- консоль: выбор вида фишки кликом по занятой ячейке ----
  // Законные виды считает тот же код, что и панель карты, а он — тем же
  // hazardCardRules, которым ход потом проверит движок.
  const cardSel = isAdel && sel?.kind === 'adelCard' && !sel.hz ? sel : null;
  const cardTypes = cardSel ? availableTypes(G, hazardCardRules(G, cardSel.card)) : null;
  const canPickType = cardTypes ? (hz) => cardTypes.includes(hz) : null;
  const pickType = (hz) => setSel({ ...cardSel, hz });
  // Аномалию АДЕЛЬ активирует прямо с её ячейки на консоли; чем платить —
  // спрашивается отдельной панелью в сайдбаре.
  const canActivateAnomaly = isAdel && G.phase === 'adel' && G.adel.energy >= ANOMALY_COST
    ? (a) => setSel({ kind: 'anomalyPay', anomaly: a, pays: [], payType: null })
    : null;

  const renderAdel = () => {
    const A = G.adel;
    const phaseAdel = G.phase === 'adel';
    return (
      <div className="panel adel">
        <h3>АДЕЛЬ</h3>
        {/* Рука закрыта от экипажа (решение владельца): playerView отдаёт
            рубашки, счёт карт при этом виден. Карты рисует сама АДЕЛЬ; экипажу
            приходят закрытые карты, и CardLabel рисует их рубашкой. */}
        <h4>Рука АДЕЛЬ ({A.hand.length}/{ADEL_HAND_LIMIT}){!isAdel && ' · закрыта'}</h4>
        {/* Ключ — по номеру в руке, а не по id карты: закрытые карты приходят
            с одинаковым id, и React склеивал их в одну строку месива. */}
        <div className="btns">
          {A.hand.map((c, i) => (isAdel
            ? <button key={i} className={sel?.card?.id === c.id ? 'sel' : ''} disabled={!phaseAdel}
              onClick={() => setSel({ kind: 'adelCard', card: c })}
              title={c.type === 'special' ? c.text : cardLabel(c)}>
              <CardLabel card={c} />
            </button>
            : <span key={i} className="handcard" title={c.type === 'special' ? c.text : cardLabel(c)}>
              <CardLabel card={c} />
            </span>))}
        </div>
        <p className="hint">Колода: {A.deck} карт · сброс: {typeof A.discard === 'number' ? A.discard : A.discard.length}
          {' '}(состав колоды и сброса закрыт — иначе обе стороны знали бы ход событий наперёд)</p>
        {!isAdel && <p className="hint">Аномалии АДЕЛЬ — на консоли под картой, там же видно, чем платится каждая.</p>}
        {/* Дальше — пульт самой АДЕЛЬ: выбор целей, оплата аномалии,
            шпионаж, завершение фазы. Экипажу тут нажимать нечего. */}
        {isAdel && <>
        {sel?.kind === 'adelCard' &&
          <AdelCardPicker G={G} sel={sel} setSel={setSel} moves={moves} />}

        {/* Сами жетоны аномалий лежат на консоли — там же и активируются.
            Здесь остаётся только выбор, чем платить. */}
        <h4>Аномалии</h4>
        <p className="hint">
          {phaseAdel && A.energy >= ANOMALY_COST
            ? `Жетоны — на консоли под картой: кликните по жетону, чтобы активировать за ${ANOMALY_COST}⚡ и фишки с поля.`
            : `Жетоны — на консоли под картой. Активация стоит ${ANOMALY_COST}⚡ и по фишке из сектора каждого цвета, только в свою фазу.`}
        </p>
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

        {/* Под наблюдением: фишка шпионажа даёт АДЕЛЬ видеть предметы в локации
            в любой момент и инвентарь члена экипажа, попавшего туда. Данные уже
            раскрыты в playerView (spyVision) — здесь только показ. */}
        {(() => {
          const watched = [];
          for (let l = 1; l <= 20; l++) {
            if (!G.board[l]?.hazards.spy) continue;
            const items = G.board[l].items.filter(it => it.faceUp || it.known);
            const crew = Object.entries(G.players).filter(([, p]) => !p.inSpace && !p.dead && p.pos === l);
            if (!items.length && !crew.length) continue;
            watched.push({ loc: l, items, crew });
          }
          if (!watched.length) return null;
          return <>
            <h4>Под наблюдением (шпионаж)</h4>
            <div className="watchlist">
              {watched.map(w => <div key={w.loc} className="watchloc">
                <b>Локация {w.loc}</b>
                {w.items.length > 0 && <span className="watchitems"> · предметы: {w.items.map((it, i) =>
                  <ItemCard key={i} id={it.id} size="thumb" popover />)}</span>}
                {w.crew.map(([pid, p]) => <div key={pid} className="watchinv">
                  👁 {CHARACTERS[p.character].name}: {p.inventory.length
                    ? p.inventory.map((it, i) => <ItemCard key={i} id={it.id} size="thumb" popover />)
                    : 'инвентарь пуст'}
                </div>)}
              </div>)}
            </div>
          </>;
        })()}

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
          {/* Финальный предмет миссии — карточкой прямо в шапке (топор/шлем). */}
          <span className={'mtag blue' + (blueLeft === 0 && damage === 0 ? ' ready' : '')}>
            <ItemCard id="axe" size="thumb" className="mfinal" />
            СИНЯЯ · отключить АДЕЛЬ · финал: топор → лок. 20<br />
            осталось предметов: {blueLeft} · повреждений на корабле: {damage}
            {blueLeft === 0 && damage === 0 && ' · топор готов'}
          </span>
          <span className={'mtag red' + (redOut ? ' blocked' : (redLeft === 0 ? ' ready' : ''))}>
            <ItemCard id="helmet" size="thumb" className="mfinal" />
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
            // Сам ПРЕДМЕТ маркера известен всем (в playerView скрывается только
            // m.loc). Поэтому карточку предмета показываем всегда — не утекает
            // ничего; скрыта лишь локация, о чём и говорит пометка.
            return <div key={s} className={`marker m-${mission}` + (m.revealed ? ' done' : '')}>
              <ItemCard id={s} size="thumb" delivered={m.revealed}
                note={!m.revealed && !known ? '▩ локация скрыта' : null} />
              <div className="minfo">
                <b>{ITEMS[s].name}</b>
                <span>{m.revealed ? `✅ доставлено (лок. ${m.loc})` : known ? `→ лок. ${m.loc} (видно вам)` : '▩ локация скрыта'}</span>
                <i>{G.missions.viewers[s].map(v => CHARACTERS[G.players[v]?.character]?.name).join(', ')}</i>
              </div>
            </div>;
          })}
        </div>
        <p className="hint">Ход: <b>{G.turnNo}</b> · Точка невозврата: <b>{G.pointOfNoReturn}</b>
          {' '}(двигается только событием «Дрейф»; командный терминал — на 1 назад)
          {G.anomaliesActive.length > 0 && <> · Аномалии: {G.anomaliesActive.map(a => ANOMALIES[a].name).join(', ')}</>}</p>
      </div>
    );
  };

  const ev = G.currentEvent && EVENTS[G.currentEvent.id];
  const nx = G.nextEvent && EVENTS[G.nextEvent.id];

  // Фаза и событие переехали из шапки в сайдбар: под фазой сразу идёт то, что
  // от игрока в этой фазе требуется, — планирование, действия, разбор гипоксии.
  const renderPhase = () => (
    <div className="panel phasebox">
      <h3>Фаза · ход {G.turnNo}</h3>
      <p className="phase">
        {G.winner ? (G.winner === 'crew' ? '🎉 ПОБЕДА ЭКИПАЖА' : '🤖 ПОБЕДА АДЕЛЬ') :
          { event: '⚔ События: атака АДЕЛЬ', planning: '📝 Планирование', adel: '🤖 Фаза АДЕЛЬ',
            actions: '🚀 Фаза действий', reveal: '👀 Розыгрыш', endturn: '⏳ Конец хода' }[G.phase]}
      </p>
      <div className="event">
        {ev && <span className={G.currentEvent.cancelled ? 'cancelled' : ''}>
          Событие: <b>{ev.name}</b> <i className={'hex ' + G.currentEvent.color} title={`цвет: ${SECTOR_NAMES[G.currentEvent.color]}`} />
          {G.currentEvent.panic && <span title="значок паники: сработает одноимённая аномалия">😱</span>} — {ev.text}
        </span>}
        {nx && <span className="next">Далее: {nx.name}
          {G.nextEvent.color && <i className={'hex ' + G.nextEvent.color} title={`цвет: ${SECTOR_NAMES[G.nextEvent.color]}`} />}
          {G.nextEvent.panic && '😱'}{G.nextEvent.cancelled ? ' (отменено)' : ''}</span>}
      </div>
      {/* Анимация кубика живёт несколько секунд, и застать её может не каждый.
          Итог последнего броска остаётся здесь, пока не случится следующий. */}
      <LastRoll G={G} />
    </div>
  );

  return (
    <div className="game">
      <header>
        <div className="logo small">А.Д.Е.Л.Ь.</div>
        <div className="phase">Ход {G.turnNo} · точка невозврата {G.pointOfNoReturn}</div>
      </header>

      <div className="cols">
        <div className="mapwrap">
          {/* Плашка выбора цели закреплена на экране, а не приклеена к карте:
              карта больше не «липкая» (под ней консоль), и при прокрутке к
              панели действий подсказка уезжала за верхний край — казалось,
              что кнопка просто не работает. */}
          {sel && <div className="selbanner">
            Выберите цель на карте
            {sel.targets?.length ? <>: {sel.targets.map(l =>
              <button key={l} className="seltarget" onClick={() => { clickLoc(l); }}>лок. {l}</button>)}</> : '…'}
            <button onClick={() => setSel(null)}>отмена</button>
          </div>}
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
                  <rect width={BOX_W} height={BOX_H} rx="12" className="loc"
                    style={{ stroke: SECTOR_TINT[SECTOR_OF[l]] }} />
                  <text x="10" y="24" className="locnum">{l}</text>
                  {TERMINALS[l] && <text x="10" y="41" className="term">{TERMINAL_NAMES[TERMINALS[l]].replace('Терминал ', 'T·').replace(' терминал', '')}</text>}
                  {/* Метки состояния — в правом верхнем углу, чтобы не спорить за
                      место с фишками и предметом внизу. */}
                  {G.alarmTerminals.includes(+l) && <text x="99" y="21" className="alarm">⏰</text>}
                  {HATCHES[l] && <text x="99" y="41" className="hatch"><title>люк</title>◨</text>}
                  {/* Предмет в локации: известный — названием, скрытый — значком ▩
                      (серый; сам предмет публичен, скрыта только локация). Сидит в
                      среднем ряду, НАД нижней полосой фишек — они не наезжают. */}
                  {L.items.length > 0 && (() => {
                    const known = L.items.filter(it => it.faceUp || it.known);
                    const hiddenN = L.items.length - known.length;
                    const names = known.map(it => ITEMS[it.id]?.name ?? '?').join(', ');
                    const long = names.length > 12;
                    return <>
                      {hiddenN > 0 && <text x="10" y="59" className="itmhidden">
                        ▩{hiddenN > 1 ? `×${hiddenN}` : ''}
                        <title>{`${hiddenN > 1 ? `${hiddenN} неизвестных предмета` : 'неизвестный предмет'} — обыщите локацию`}</title>
                      </text>}
                      {names && <text x={hiddenN > 0 ? 40 : 10} y="57" className="itm"
                        {...(long ? { textLength: BOX_W - (hiddenN > 0 ? 50 : 20), lengthAdjust: 'spacingAndGlyphs' } : {})}>
                        {names}<title>{names}</title>
                      </text>}
                    </>;
                  })()}
                  {/* Фишки опасностей — полосой у нижнего края слева, С ОТСТУПАМИ от
                      краёв коробки (видно, что фишка внутри локации). Метки без арта
                      (повреждение, ⛔) — эмодзи. Пешки экипажа рисуются следом. */}
                  {(() => {
                    const icons = hazIcons(+l);
                    const S = 24, gap = 2, yTop = BOX_H - S - 6;
                    return icons.map((ic, i) => {
                      const cx = 6 + i * (S + gap);
                      const src = ic.type ? chipSrc(ic.type) : null;
                      if (src) return (
                        <image key={i} href={src} x={cx} y={yTop} width={S} height={S} className="hzchip">
                          <title>{ic.label || HAZARD_NAMES[ic.type]}</title>
                        </image>);
                      return (
                        <text key={i} x={cx + 4} y={BOX_H - 10} className="hz">
                          {ic.emoji || HAZARD_ICON[ic.type]}<title>{ic.label || HAZARD_NAMES[ic.type]}</title>
                        </text>);
                    });
                  })()}
                  {/* Пешки экипажа — в правом нижнем углу, с отступом от кромок,
                      чтобы не вылезали за скруглённый угол коробки. */}
                  {here.map(([pid, p], i) =>
                    <circle key={pid} cx={92 - i * 21} cy="72" r="13" className={'pawn c' + pid}>
                      <title>{CHARACTERS[p.character].name}</title>
                    </circle>)}
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

          {/* Легенда «что есть что»: фишка + название, чтобы новым игрокам не
              гадать, что за значок на карте и в ячейках консоли. */}
          <div className="legend">
            {HAZARDS.map(h => (
              <span key={h} className="legitem" title={HAZARD_NAMES[h]}>
                <ChipIcon type={h} /><span>{HAZARD_NAMES[h]}</span>
              </span>
            ))}
          </div>

          {/* Консоль — под картой и на всю ширину, как планшет на столе. Она
              открыта всем: в жизни он тоже лежит лицом вверх. */}
          <AdelConsole G={G} numPlayers={G.numPlayers}
            canPickType={canPickType} onPickType={pickType}
            onActivateAnomaly={canActivateAnomaly} />
        </div>

        <div className="side">
          {G.winner && <div className="panel winner">{G.winner === 'crew' ? '🎉 Экипаж побеждает!' : '🤖 АДЕЛЬ побеждает.'}</div>}
          {/* Отдельной панели «мой персонаж» нет: имя, дух и шкала ран уже есть
              в списке экипажа, а вторая копия только занимала место. */}
          <CrewRoster G={G} me={me} nickOf={nickOf} />
          {renderPhase()}
          {/* myP отсутствует у наблюдателя и при чужом playerID — без проверки
              весь экран падал бы на первом же обращении к полям игрока */}
          {!isAdel && !G.winner && myP && !myP.dead && myP.pendingHypoxia > 0 && renderHypoxia()}
          {!isAdel && !G.winner && myP && !myP.dead && myP.pendingDrop > 0 && !active && renderDropOnly()}
          {!isAdel && !G.winner && myP && !myP.dead && G.phase === 'planning' && renderPlanning()}
          {!isAdel && !G.winner && myP && !myP.dead && G.phase === 'actions' && renderActions()}
          {/* Постоянная панель инвентаря: видна во всех фазах, в свой ход —
              с рабочими кнопками, иначе информационная. */}
          {!isAdel && myP && renderInventory()}
          {!isAdel && myP && !myP.dead && renderScouted()}
          {/* Панель АДЕЛЬ видят все: рука закрыта (виден только счёт), пульт
              внутри — только для самой АДЕЛЬ. */}
          {renderAdel()}
          {renderMissions()}
          {!isAdel && G.privateLog?.length > 0 && <div className="panel log private">
            <h3>Только вам</h3>
            <div className="logbody">{[...G.privateLog].reverse().map((l, i) => <p key={i}>{l}</p>)}</div>
          </div>}
          <div className="panel log">
            <h3>Журнал</h3>
            {/* Ник из лобби подставляется у первого упоминания персонажа в ходе. */}
            <div className="logbody">{annotateLog(G.log, G.players, nickOf).slice().reverse().map((l, i) => <p key={i}>{l}</p>)}</div>
          </div>
          {msg && <div className="toast">{msg}</div>}
        </div>
      </div>

      {/* Проверка духа перекрывает всё: пока свой кубик не брошен, других
          действий нет. У зрителя и АДЕЛЬ вместо кнопки — строка ожидания. */}
      <SpiritPrompt G={G} playerID={me} moves={moves} />
      {shown && <RollOverlay G={G} roll={shown.roll} spinning={shown.spinning} />}
    </div>
  );
}

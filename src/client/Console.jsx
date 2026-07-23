// Консоль АДЕЛЬ — воспроизведение физического планшета.
//
// Устройство планшета (сверено по фото коробки):
//   • трек энергии 0–50 идёт по ПЕРИМЕТРУ — слева снизу вверх, поверху
//     направо, справа сверху вниз; маркер-цилиндр стоит на текущем делении;
//   • под верхней частью трека — полоса из четырёх ячеек аномалий, по краям
//     полосы напечатана цена активации 5⚡;
//   • основная сетка — КОЛОНКИ по цене выкладывания: метка цены сверху,
//     ячейки вниз. Колонка на 10 ячеек занимает две подколонки по пять,
//     колонка на 3–4 ячейки кончается выше остальных (низ сетки рваный);
//   • внизу — полоса памятки: сколько фишек тянуть, что энергия тратится,
//     сколько её приходит в конце фазы.
//
// Консоль открыта всем: за столом планшет тоже лежит лицом вверх.
import React from 'react';
import {
  HAZARD_NAMES, CONSOLE_COSTS, CONSOLE_LAYOUT, CONSOLE_ORDER, SECTOR_NAMES,
  ANOMALIES, ANOMALY_COST, ENERGY_MAX, ADEL_HAND_LIMIT,
  energyFor, chipsPerTurn,
} from '../game/data.js';
import { ChipIcon } from './icons.jsx';

// Сколько делений трека уходит на каждую сторону планшета. Деления — единицы
// энергии от 0 до 50 включительно; подписаны кратные пяти, как на планшете.
const EN_LEFT_TOP = 10;          // левая сторона: 0…10 снизу вверх
const EN_RIGHT_FROM = 40;        // правая сторона: 40…50 сверху вниз
const enRange = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// Высота сетки в ячейках: самые ёмкие колонки (10 ячеек) ложатся в две
// подколонки по пять — из этого же числа считается ширина каждой колонки.
const CONSOLE_ROWS = 5;

// Одна колонка цены: ячейки нужных видов в постоянном порядке, занятые —
// первыми внутри своего вида. Отдельно помечается фишка, которую АДЕЛЬ снимет
// следующей: по правилам она обязана взять самую дорогую фишку своего вида.
export function consoleRow(A, cost) {
  const cells = [];
  for (const h of CONSOLE_ORDER) {
    const capacity = CONSOLE_LAYOUT[cost]?.[h] || 0;
    const row = A.console[h] || [];
    const filled = row.filter(x => x === cost).length;
    const top = row.length ? row[row.length - 1] : null;
    for (let i = 0; i < capacity; i++) {
      const on = i < filled;
      cells.push({ type: h, on, next: on && top === cost && i === filled - 1 });
    }
  }
  return cells;
}

// Деление трека энергии.
function EnTick({ n, energy, after }) {
  const cls = ['entick',
    n <= energy ? 'full' : '',
    n % 5 === 0 ? 'dec' : '',
    n === after && n !== energy ? 'refill' : '',
    n === energy ? 'here' : ''].filter(Boolean).join(' ');
  const title = n === energy ? `Текущий запас: ${n}⚡`
    : n === after ? `После пополнения: ${n}⚡` : `${n}⚡`;
  return (
    <i className={cls} title={title}>
      {n % 5 === 0 && <b className="ennum">{n}</b>}
      {n === energy && <b className="encyl" />}
    </i>
  );
}

// Полоса из четырёх ячеек аномалий с ценой активации по краям. Жетоны открыты
// всем, поэтому на каждом видно и название, и главное — из секторов КАКИХ
// ЦВЕТОВ придётся снять по фишке: без этого по жетону не понять, чем платить.
function AnomalySlots({ anomalies, active, onActivate }) {
  return (
    <div className="anombar">
      <span className="anomcost" title={`Активация аномалии стоит ${ANOMALY_COST}⚡ и по фишке с поля`}>
        −{ANOMALY_COST}⚡</span>
      <div className="anomslots">
        {anomalies.map((a, i) => {
          // Незнакомый ключ (например, 'hidden' от старого сервера, который
          // ещё прячет аномалии) не должен ронять весь экран — рисуем рубашку.
          const A = ANOMALIES[a];
          if (!A) return <i key={i} className="anom facedown" title="Жетон закрыт">▩ жетон лицом вниз</i>;
          const on = active.includes(a);
          const cls = 'anom' + (on ? ' on' : '');
          const title = `${A.text} · плата: ${ANOMALY_COST}⚡ и по фишке из секторов `
            + A.colors.map(c => SECTOR_NAMES[c]).join(', ');
          const body = <>
            <b>{on && '✓ '}{A.name}</b>
            <span className="anomhex">
              {A.colors.map((c, k) => <i key={k} className={'hex ' + c} title={SECTOR_NAMES[c]} />)}
            </span>
          </>;
          return (onActivate && !on)
            ? <button key={i} className={cls} title={title} onClick={() => onActivate(a)}>{body}</button>
            : <i key={i} className={cls} title={title}>{body}</i>;
        })}
      </div>
      <span className="anomcost">−{ANOMALY_COST}⚡</span>
    </div>
  );
}

// canPickType — предикат «этим видом сейчас можно сыграть выбранную карту».
// Пока он не передан, консоль просто показывает состояние: ячейки не кнопки.
export function AdelConsole({ G, numPlayers, canPickType, onPickType, onActivateAnomaly }) {
  const A = G.adel;
  const refill = energyFor(numPlayers);
  const after = Math.min(ENERGY_MAX, A.energy + refill);
  const bag = typeof A.bag === 'number' ? A.bag : Object.values(A.bag).reduce((a, b) => a + b, 0);
  const tick = (n) => <EnTick key={n} n={n} energy={A.energy} after={after} />;

  return (
    <div className="panel console">
      <h3>Консоль АДЕЛЬ</h3>
      <div className="contab">
        {/* Трек энергии по периметру: слева снизу вверх, поверху направо,
            справа сверху вниз — как напечатано на планшете. */}
        <div className="enside enleft">{enRange(0, EN_LEFT_TOP).map(tick)}</div>
        <div className="entop">{enRange(EN_LEFT_TOP + 1, EN_RIGHT_FROM - 1).map(tick)}</div>
        <div className="enside enright">{enRange(EN_RIGHT_FROM, ENERGY_MAX).map(tick)}</div>

        <div className="conmain">
          <AnomalySlots anomalies={A.anomalies} active={G.anomaliesActive}
            onActivate={onActivateAnomaly} />

          {canPickType && <p className="conpick">Выберите вид фишки — кликните по занятой ячейке в её колонке.</p>}
          <div className="congrid">
            {CONSOLE_COSTS.map((cost, i) => (
              <React.Fragment key={cost}>
                {/* Разделитель посреди сетки — как стрелка энергии на планшете. */}
                {i === 4 && <div className="conbolt" aria-hidden="true">⚡<span>↓</span></div>}
                {/* Ширина колонки — по числу подколонок: колонка на 10 ячеек
                    вдвое шире колонки на 5, и вместе они растягиваются на всю
                    ширину планшета, а не жмутся к левому краю. */}
                <div className="concol"
                  style={{ '--w': Math.ceil(consoleRow(A, cost).length / CONSOLE_ROWS) }}>
                  <span className="conprice">−{cost}<i>⚡</i></span>
                  <span className="conchev" aria-hidden="true">⌄</span>
                  <div className="concells" style={{ gridTemplateRows: `repeat(${CONSOLE_ROWS}, 1fr)` }}>
                    {consoleRow(A, cost).map((cell, j) => {
                      const pickable = Boolean(cell.on && canPickType && canPickType(cell.type));
                      const cls = ['chip', cell.on ? 'on' : 'off', cell.next ? 'next' : '',
                        pickable ? 'pick' : ''].filter(Boolean).join(' ');
                      const title = `${HAZARD_NAMES[cell.type]} — ${cost}⚡`
                        + (cell.on ? (cell.next ? ' · снимается следующей' : '') : ' (пусто)');
                      return pickable
                        ? <button key={j} className={cls} title={title} onClick={() => onPickType(cell.type)}>
                          <ChipIcon type={cell.type} small /></button>
                        : <i key={j} className={cls} title={title}><ChipIcon type={cell.type} small /></i>;
                    })}
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Полоса памятки внизу планшета: добор фишек → трата энергии →
              пополнение в конце фазы. */}
          <div className="remind">
            <span className="rstep">⬤⬤⬤ <b>{chipsPerTurn(numPlayers)}</b> фишки за ход</span>
            <span className="rstep">◎ ⚡ трата по цене колонки</span>
            <span className="rstep">↑⚡<b>{energyFor(numPlayers)}</b> пополнение, не выше {ENERGY_MAX}</span>
            <span className="rstep">рука <b>{ADEL_HAND_LIMIT}</b> карты</span>
          </div>
        </div>
      </div>

      <p className="hint">Мешочек: {bag} фишек · Колода: {A.deck} · Сброс фишек: {A.chipDiscard.length}
        {' · '}Новая фишка занимает самую дешёвую свободную ячейку; выкладывается всегда
        самая дорогая фишка нужного вида — она подсвечена.</p>
    </div>
  );
}

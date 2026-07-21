// Проверка духа в интерфейсе: обязательная плашка тому, чей бросок, и общая
// для всех анимация выпавшей грани.
//
// Компоненты чистые — состояние приходит пропсами, как в AdelCards.jsx. Иначе
// их нельзя было бы проверить рендером: в SSR-тесте эффекты не выполняются, и
// всё, что живёт во внутреннем useState, остаётся непроверяемым.
import React from 'react';
import {
  CHARACTERS, SPIRIT_REASONS, SPIRIT_REASONS_OF, SPIRIT_MOD_NAMES, DIE_FACES,
} from '../game/data.js';

// Сколько кубик «крутится» и сколько результат висит на экране.
export const SPIN_MS = 1000;
export const ROLL_HOLD_MS = 3400;

// Что делать по приходу нового броска: крутить и сколько держать — или ничего,
// если бросок уже показан. Вынесено из эффекта отдельной функцией нарочно:
// эффект выполняется только в браузере, серверный рендер его не запускает, и
// внутри эффекта эту логику проверить нечем.
//
// Отсчёт ведётся по seq, а не по самому броску: две одинаковые грани подряд
// иначе слились бы в «уже показано».
export function rollShowPlan(lastRoll, seenSeq, reducedMotion = false) {
  const seq = lastRoll?.seq || 0;
  if (seq <= seenSeq) return null;
  // При prefers-reduced-motion вращения нет вовсе — сразу результат, а не
  // замедленная прокрутка.
  const spin = reducedMotion ? 0 : SPIN_MS;
  return { seq, spin, hold: spin + ROLL_HOLD_MS };
}

// «Пожар в локации 13» — причина вместе с обстоятельствами.
export function checkTitle(check) {
  const name = SPIRIT_REASONS[check.reason] || 'Проверка духа';
  return check.context?.loc != null ? `${name} в локации ${check.context.loc}` : name;
}

// «дух 3 − 1 стресс = 2»: игрок должен видеть, из чего сложился его порог.
export function targetBreakdown(check) {
  const parts = [`дух ${check.base}`];
  for (const m of check.modifiers || []) {
    parts.push(`${m.delta > 0 ? '+' : '−'} ${Math.abs(m.delta)} ${SPIRIT_MOD_NAMES[m.key] || m.key}`);
  }
  return `${parts.join(' ')} = ${check.target}`;
}

// Плашка поверх всего: пока не брошено, других действий нет.
export function SpiritPrompt({ G, playerID, moves }) {
  const check = G.pendingChecks?.[0];
  if (!check) return null;
  const mine = check.pid === playerID;
  const who = CHARACTERS[G.players[check.pid]?.character]?.name || 'Экипаж';

  // Зритель и АДЕЛЬ видят, чьего броска ждут, но кнопки у них нет.
  if (!mine) {
    return <div className="rollwait">🎲 Ждём бросок: <b>{who}</b> — {checkTitle(check)}</div>;
  }
  return (
    <div className="rollmodal">
      <div className="rollcard">
        <h3>Проверка духа</h3>
        <p className="rollreason">{checkTitle(check)}</p>
        <p className="rolltarget">Ваш порог: <b>{check.target}</b> <i>({targetBreakdown(check)})</i></p>
        <p className="hint">Успех — если на кубике выпадет не больше порога. Единица проходит всегда.</p>
        <button className="primary rollbtn" onClick={() => moves.rollSpirit()}>🎲 Бросить кубик</button>
        <p className="hint">Пока не бросите, остальные действия недоступны — это обязательный ход.</p>
      </div>
    </div>
  );
}

// Разбор броска в словах — общий для оверлея и для строки «последний бросок»
// в панели фазы. Считается одним куском, чтобы подписи не разошлись.
export function rollParts(G, roll) {
  return {
    who: CHARACTERS[G.players[roll.pid]?.character]?.name || 'Экипаж',
    against: SPIRIT_REASONS_OF[roll.reason] || 'опасности',
    sign: roll.die <= roll.target ? '≤' : '>',
    // Единица проходит всегда — иначе «1 > 0 — успех» читалось бы ошибкой.
    natural: roll.ok && roll.die > roll.target,
  };
}

// След от броска, который не исчезает: анимацию можно и не застать, а знать,
// чем кончилась последняя проверка, нужно всем.
export function LastRoll({ G }) {
  const roll = G.lastRoll;
  if (!roll) return null;
  const { who, against, sign } = rollParts(G, roll);
  return (
    <p className={'lastroll ' + (roll.ok ? 'ok' : 'bad')}>
      🎲 {DIE_FACES[roll.die - 1]} {who} против {against}: {roll.die} {sign} {roll.target} —
      {' '}<b>{roll.ok ? 'успех' : 'провал'}</b>
    </p>
  );
}

// Оверлей с кубиком. Видят все: сервер уже всё разыграл, анимация показывает
// готовый результат из состояния, поэтому разойтись с игрой она не может.
// spinning — только внешний вид: пока крутится, подпись скрыта.
export function RollOverlay({ G, roll, spinning }) {
  if (!roll) return null;
  const { who, against, sign, natural } = rollParts(G, roll);
  return (
    <div className="rolloverlay">
      <div className={'rollbox ' + (roll.ok ? 'ok' : 'bad')}>
        <div className={'die' + (spinning ? ' spin' : '')}>
          {spinning
            ? <span className="reel">{DIE_FACES.map((f, i) => <span key={i}>{f}</span>)}</span>
            : <span className="face">{DIE_FACES[roll.die - 1]}</span>}
        </div>
        {!spinning && <p className="rollsay">
          {who} против {against}: {roll.die} {sign} {roll.target} — <b>{roll.ok ? 'успех' : 'провал'}</b>
          {natural && <i> (единица проходит всегда)</i>}
        </p>}
      </div>
    </div>
  );
}

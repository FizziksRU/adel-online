// Шкала здоровья с планшета персонажа: клетки, маркер-кубик и отметки клеток,
// на которых теряется ячейка инвентаря.
//
// Здоровье в этой игре публично — по правилам раны отмечаются кубиком на
// открытом планшете. Поэтому шкалы всего экипажа видны всем, включая АДЕЛЬ,
// и playerView их не прячет.
import React from 'react';
import { CHARACTERS, HEALTH_CELLS, HEALTH_DEATH, HEALTH_ICON, SPACE_NAMES } from '../game/data.js';

// Одна шкала: шесть клеток (0 — целый персонаж, раны 1…5) и клетка черепа —
// на неё маркер уходит с шестой раной. Клетки из invLoss помечены значком
// инвентаря прямо на шкале: так видно, ДО чего осталось сколько ран, а не
// только сколько уже есть.
export function HealthTrack({ character, health, dead }) {
  const ch = CHARACTERS[character];
  if (!ch) return null;
  return (
    <div className="htrack" title={`Раны: ${health}/${HEALTH_DEATH}`}>
      {HEALTH_CELLS.map(n => {
        const skull = n === HEALTH_DEATH;
        // Маркер всегда один: у погибшего он стоит на черепе, у живого — на
        // клетке своих ран.
        const here = dead ? skull : health === n;
        const loses = ch.invLoss.includes(n);
        const cls = ['hcell', skull ? 'skull' : '', here ? 'here' : '', loses ? 'loss' : '']
          .filter(Boolean).join(' ');
        return (
          <i key={n} className={cls}
            title={skull ? `${HEALTH_DEATH}-я рана убивает`
              : loses ? `${n}-я рана: теряется ячейка инвентаря` : `${n} ран`}>
            {here
              ? <b className="hmark">{HEALTH_ICON.marker}</b>
              : skull ? HEALTH_ICON.skull : (loses ? HEALTH_ICON.invLoss : (n || '·'))}
          </i>
        );
      })}
    </div>
  );
}

// Список экипажа со шкалами. Видят все: и напарники, и АДЕЛЬ, и зритель.
// nickOf(pid) — ник игрока из лобби (или null): показывается рядом с именем
// персонажа. Без него (наблюдатель, реконнект) — просто имя персонажа.
export function CrewRoster({ G, me, nickOf = () => null }) {
  const crew = Object.entries(G.players);
  if (!crew.length) return null;
  return (
    <div className="panel crew">
      <h3>Экипаж · здоровье</h3>
      {crew.map(([pid, p]) => {
        const ch = CHARACTERS[p.character];
        const nick = nickOf(pid);
        return (
          <div key={pid} className={'crewrow' + (pid === me ? ' mine' : '') + (p.dead ? ' dead' : '')}>
            {/* Дух в скобках прямо у имени: порог проверки виден, не заглядывая
                в планшет персонажа, и сразу понятно, кому пожар страшнее. */}
            <span className="cname">
              <i className={'pawndot c' + pid} />{ch?.name || '???'}
              {nick && <span className="pnick"> · {nick}</span>}
              {ch && <b className="cspirit" title={`Дух ${ch.spirit} — порог проверки духа`}>({ch.spirit})</b>}
              {/* Своё положение подписываем словами: у остальных оно и так
                  видно фишкой на карте, а себя искать глазами неудобно. */}
              {pid === me && <em> · вы, {p.inSpace ? `космос ${SPACE_NAMES[p.inSpace]}` : `локация ${p.pos}`}</em>}
            </span>
            <HealthTrack character={p.character} health={p.health} dead={p.dead} />
          </div>
        );
      })}
      <p className="hint">В скобках — дух персонажа (порог проверки). {HEALTH_ICON.marker} — маркер ран,
        {' '}{HEALTH_ICON.invLoss} — на этой ране теряется ячейка инвентаря,
        {' '}{HEALTH_ICON.skull} — гибель. Здоровье в игре открыто.</p>
    </div>
  );
}

// Бот экипажа для честного отыгрыша партии.
//
// Зачем: партию нельзя считать отыгранной, если ключевые предметы просто
// положили игроку в инвентарь. По правилам экипаж обязан их НАЙТИ — ходить по
// кораблю, тратить действие «поиск», а найдя чужой ключевой предмет, ещё и
// договориться с напарником, в какую локацию его нести.
//
// Бот делает всё это настоящими ходами:
//   • обходит корабль по маршруту и обыскивает локации;
//   • забирает ключевые предметы;
//   • свои маркеры знает, чужие — узнаёт при встрече в одной локации;
//   • предмет, локация которого ему неизвестна, несёт напарнику, который знает;
//   • доставляет спец. действием в нужной локации;
//   • финальный предмет активирует, только когда выполнены условия миссии.
//
// Маршруты обхода заданы сценарием — это «план команды», а не подсказка движка:
// где лежат предметы, бот заранее не знает и узнаёт только поиском.
import {
  ADJ, ITEMS, CHARACTERS, CUBE_ACTIONS, MARKER_SLOTS,
  BLUE_FINAL_LOC, RED_FINAL_LOC, TERMINALS,
} from '../src/game/data.js';

// Локация ремонтного терминала — берём из данных, а не числом.
const REPAIR_LOC = Number(Object.keys(TERMINALS).find(l => TERMINALS[l] === 'repair'));
import { Adel } from '../src/game/index.js';

const mv = (name) => Adel.moves[name].move;
const NO_CUBES = { move: 0, search: 0, activate: 0, special: 0, door: 0 };

// Кратчайший путь по открытым проёмам.
export function route(G, from, to) {
  if (from === to) return [];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    for (const nb of ADJ[at]) {
      if (prev[nb] !== undefined) continue;
      if (G.board[at].doors.includes(nb) || G.board[nb].doors.includes(at)) continue;
      prev[nb] = at;
      if (nb === to) {
        const path = [];
        for (let x = to; x !== from; x = prev[x]) path.unshift(x);
        return path;
      }
      queue.push(nb);
    }
  }
  return null; // все двери заперты
}

const specialCost = (G, pid) =>
  (CHARACTERS[G.players[pid].character].special === 'cheap_special' ? 2 : 3);
const free = (P, k) => (P.plan ? P.plan[k] - P.plan.spent[k] : 0);
const freeAll = (P) => CUBE_ACTIONS.reduce((s, k) => s + free(P, k), 0) + (P.bonusCubes || 0);
const keyItems = (P) => P.inventory.filter(it => ITEMS[it.id].kind === 'key');

// Куда нести предмет: свой маркер игрок знает всегда, чужой — только если
// напарник рассказал при встрече. Финальные предметы известны всем.
function targetOf(G, pid, itemId, known) {
  if (ITEMS[itemId].final) return itemId === 'axe' ? BLUE_FINAL_LOC : RED_FINAL_LOC;
  if (G.missions.viewers[itemId].includes(pid)) return G.missions.markers[itemId].loc;
  return known[itemId] ?? null;
}

// Пора нести финальный предмет? Бот смотрит ТОЛЬКО на публично известное —
// на три доставленных предмета. Хватает ли условий миссии (чистое поле для
// синей, запас времени для красной) решает движок, когда бот попробует.
//
// Это принципиально: если продублировать условие здесь, тест перестанет
// замечать, что движок его потерял, — бот просто не пойдёт в финал, и партия
// пройдёт как ни в чём не бывало.
function finalReady(G, itemId) {
  const D = G.missions.delivered;
  return itemId === 'axe'
    ? Boolean(D.blue_card && D.id_badge && D.lens)
    : Boolean(D.chipItem && D.toolbox && D.lens);
}

// Что игрок собирается делать в этот ход.
// Возвращает { kind: 'deliver'|'handover'|'search', loc, itemId }.
export function intent(G, pid, S) {
  const P = G.players[pid];
  const mine = keyItems(P);
  const known = S[pid].known;

  // 1. Доставить то, что можем доставить.
  for (const it of mine) {
    if (ITEMS[it.id].final) continue;
    if (G.missions.delivered[it.id]) continue;
    const loc = targetOf(G, pid, it.id, known);
    if (loc != null) return { kind: 'deliver', loc, itemId: it.id };
  }
  // 2. Синей миссии мешает жетон повреждения — идём к ремонтному терминалу.
  // Он убирает повреждение откуда угодно с корабля, так что бежать к самой
  // пробоине не нужно.
  const damaged = Object.keys(G.board).map(Number).filter(l => G.board[l].damage);
  if (S[pid].finalFailed && damaged.length && mine.some(it => it.id === 'axe')) {
    return { kind: 'repair', loc: REPAIR_LOC, itemId: null, fix: damaged[0] };
  }
  // 3. Финальный предмет — когда условия выполнены.
  for (const it of mine) {
    if (ITEMS[it.id].final && finalReady(G, it.id)) {
      return { kind: 'deliver', loc: targetOf(G, pid, it.id, known), itemId: it.id };
    }
  }
  // 4. Чужой предмет, локация которого нам неизвестна, — несём тому напарнику,
  // который её знает (в экипаже их может быть несколько).
  const others = Object.keys(G.players).filter(p => p !== pid && !G.players[p].dead);
  for (const it of mine) {
    if (ITEMS[it.id].final || G.missions.delivered[it.id]) continue;
    if (targetOf(G, pid, it.id, known) != null) continue;
    const knower = others.find(o => !G.players[o].inSpace && G.missions.viewers[it.id].includes(o));
    if (knower) return { kind: 'handover', loc: G.players[knower].pos, itemId: it.id, partner: knower };
  }
  // 5. Напарник несёт предмет, локацию которого знаем мы, — стоим и ждём:
  // иначе двое будут бегать друг за другом по кораблю.
  for (const other of others) {
    for (const it of keyItems(G.players[other])) {
      if (ITEMS[it.id].final || G.missions.delivered[it.id]) continue;
      const theyKnow = targetOf(G, other, it.id, S[other].known) != null;
      const weKnow = targetOf(G, pid, it.id, S[pid].known) != null;
      if (!theyKnow && weKnow) return { kind: 'wait', loc: P.pos };
    }
  }
  // 6. Иначе — обход и поиск.
  const patrol = S[pid].patrol;
  const next = patrol[S[pid].step % patrol.length];
  return { kind: 'search', loc: next };
}

// Раскладка кубиков под задуманное. Всё как у живого игрока: программировать
// приходится заранее, зная только собственное положение и намерение.
export function planFor(G, pid, S) {
  const P = G.players[pid];
  const goal = intent(G, pid, S);
  const path = route(G, P.pos, goal.loc);
  const dist = path ? path.length : 0;

  if (goal.kind === 'deliver' || goal.kind === 'repair') {
    const cost = specialCost(G, pid);
    if (dist + cost <= 4) {
      return { ...NO_CUBES, move: dist, special: cost, search: 4 - dist - cost };
    }
    return { ...NO_CUBES, move: 4 };
  }
  if (goal.kind === 'handover') return { ...NO_CUBES, move: 4 };
  if (goal.kind === 'wait') return { ...NO_CUBES, search: 1, move: 3 };
  // обход: часть кубиков на дорогу, часть на обыск локаций по пути
  return { ...NO_CUBES, move: Math.min(3, Math.max(1, dist)), search: 4 - Math.min(3, Math.max(1, dist)) };
}

// Встреча в одной локации: по правилам напарники показывают друг другу маркеры
// и свободно обмениваются предметами. Знание запоминается — вслух его уже
// сказали, и «забыть» его нельзя, даже когда разойдутся.
function meet(G, pid, S) {
  const P = G.players[pid];
  if (P.inSpace) return;
  for (const other of Object.keys(G.players)) {
    if (other === pid || G.players[other].dead || G.players[other].inSpace) continue;
    if (G.players[other].pos !== P.pos) continue;
    mv('shareInfo')({ G, playerID: other }, pid, true);
    mv('shareInfo')({ G, playerID: pid }, other, true);
    for (const slot of MARKER_SLOTS) {
      if (G.missions.viewers[slot].includes(other)) S[pid].known[slot] = G.missions.markers[slot].loc;
      if (G.missions.viewers[slot].includes(pid)) S[other].known[slot] = G.missions.markers[slot].loc;
    }
    // предмет отдаём тому, кто знает, куда его нести
    for (let i = P.inventory.length - 1; i >= 0; i--) {
      const it = P.inventory[i];
      if (ITEMS[it.id].kind !== 'key' || ITEMS[it.id].final) continue;
      if (G.missions.delivered[it.id]) continue;
      const mineKnows = targetOf(G, pid, it.id, S[pid].known) != null;
      const theirsKnows = targetOf(G, other, it.id, S[other].known) != null;
      if (!mineKnows && theirsKnows) mv('giveItem')({ G, playerID: pid }, other, i);
    }
  }
}

// Разбор зависших требований — то же, что делает живой игрок перед действием.
function settle(G, pid, random) {
  const P = G.players[pid];
  for (let guard = 0; guard < 12; guard++) {
    if (P.pendingHypoxia) {
      const k = ['door', 'activate', 'special', 'search', 'move'].find(a => free(P, a) > 0);
      if (!k) break;
      mv('payHypoxia')({ G, playerID: pid }, k);
      continue;
    }
    if (P.pendingDrop) {
      // расстаёмся с тем, что не нужно миссии
      let i = P.inventory.findIndex(it => ITEMS[it.id].kind !== 'key');
      if (i < 0) i = P.inventory.length - 1;
      mv('dropItem')({ G, playerID: pid, random }, i);
      continue;
    }
    if (P.pendingLabPick) { mv('pickLab')({ G, playerID: pid }, G.labStack[0]); continue; }
    if (P.pendingMedkit) { mv('applyMedkit')({ G, playerID: pid }, pid, P.pendingMedkit); continue; }
    break;
  }
}

// Ход одного члена экипажа в фазу действий.
export function act(G, pid, S, random) {
  const P = G.players[pid];
  for (let guard = 0; guard < 14 && !G.winner; guard++) {
    settle(G, pid, random);
    if (P.pendingDrop || P.pendingHypoxia) break;
    meet(G, pid, S);

    const goal = intent(G, pid, S);
    if (P.pos === goal.loc) {
      if (goal.kind === 'deliver') {
        if (free(P, 'special') + P.bonusCubes < specialCost(G, pid)) break;
        const before = G.missions.delivered[goal.itemId];
        mv('actSpecial')({ G, playerID: pid, random }, { kind: 'deliver', itemId: goal.itemId });
        if (G.winner) return;
        if (ITEMS[goal.itemId].final) {
          // Движок отказал: условия миссии ещё не выполнены. Причину он не
          // разглашает публично, но экипаж видит поле — идём разбираться.
          S[pid].finalFailed = true;
          break;
        }
        if (G.missions.delivered[goal.itemId] === before) break;
        continue;
      }
      if (goal.kind === 'repair') {
        if (free(P, 'special') + P.bonusCubes < specialCost(G, pid)) break;
        mv('actSpecial')({ G, playerID: pid, random }, { kind: 'terminal', loc: goal.fix });
        S[pid].finalFailed = false;   // помеха устранена — можно пробовать снова
        continue;
      }
      if (goal.kind === 'handover') { meet(G, pid, S); break; }
      if (goal.kind === 'wait') break;
      // поиск: забираем ключевые предметы, прочее не трогаем
      if (free(P, 'search') + P.bonusCubes < 1) { S[pid].step += 1; break; }
      const L = G.board[P.pos];
      const keyIdx = L.items.findIndex(it => ITEMS[it.id].kind === 'key');
      mv('actSearch')({ G, playerID: pid }, keyIdx >= 0 ? keyIdx : false);
      S[pid].step += 1;   // локация осмотрена — дальше по маршруту
      continue;
    }

    const path = route(G, P.pos, goal.loc);
    if (!path || !path.length) { S[pid].step += 1; break; }
    if (freeAll(P) < 1) break;
    const r = mv('actMove')({ G, playerID: pid, random }, path[0]);
    if (r === 'INVALID_MOVE') break;
  }
  meet(G, pid, S);
}

// Начальное состояние бота: маршрут обхода и уже известные ему маркеры.
export function botState(G, patrols) {
  const S = {};
  for (const pid of Object.keys(G.players)) {
    S[pid] = { patrol: patrols[pid], step: 0, known: {}, finalFailed: false };
    for (const slot of MARKER_SLOTS) {
      if (G.missions.viewers[slot].includes(pid)) S[pid].known[slot] = G.missions.markers[slot].loc;
    }
  }
  return S;
}

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { LobbyClient } from 'boardgame.io/client';
import { Adel } from '../game/index.js';
import { TABLE_SIZE, MIN_TABLE, MAX_TABLE } from '../game/data.js';
import { Board } from './Board.jsx';
import './style.css';

const serverURL = window.location.origin;
const lobby = new LobbyClient({ server: serverURL });

// Размер стола обязателен: без него boardgame.io при синхронизации по
// неизвестному matchID создаёт партию на двоих, и раскладка не собирается.
// Составов поддержано два, поэтому клиент собирается под каждый и выбирается
// по числу мест в конкретной партии.
const CLIENTS = {};
for (let n = MIN_TABLE; n <= MAX_TABLE; n++) {
  CLIENTS[n] = Client({
    game: Adel, board: Board, numPlayers: n,
    multiplayer: SocketIO({ server: serverURL }), debug: false,
  });
}

function useHashState() {
  const parse = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
  const [h, setH] = useState(parse);
  useEffect(() => {
    const f = () => setH(parse());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const push = (obj) => { window.location.hash = new URLSearchParams(obj).toString(); };
  return [h, push];
}

function Lobby() {
  const [hash, push] = useHashState();
  const [name, setName] = useState(localStorage.getItem('adel_name') || '');
  const [match, setMatch] = useState(null);
  const [err, setErr] = useState('');
  const creds = useMemo(() => JSON.parse(localStorage.getItem('adel_creds') || '{}'), []);

  const matchID = hash.m;
  const mySeat = matchID && creds[matchID]?.seat;

  useEffect(() => {
    if (!matchID) return;
    let stop = false;
    const poll = async () => {
      try { const m = await lobby.getMatch('adel', matchID); if (!stop) setMatch(m); }
      catch (e) { if (!stop) setErr('Партия не найдена'); }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => { stop = true; clearInterval(t); };
  }, [matchID]);

  const createMatch = async (numPlayers) => {
    setErr('');
    try {
      const { matchID: id } = await lobby.createMatch('adel', { numPlayers });
      push({ m: id });
    } catch (e) { setErr('Не удалось создать партию: ' + e.message); }
  };

  const join = async (seat) => {
    setErr('');
    try {
      const { playerCredentials } = await lobby.joinMatch('adel', matchID, {
        playerID: seat, playerName: name || `Игрок ${seat}`,
      });
      creds[matchID] = { seat, credentials: playerCredentials };
      localStorage.setItem('adel_creds', JSON.stringify(creds));
      localStorage.setItem('adel_name', name);
      push({ m: matchID, p: seat });
    } catch (e) { setErr('Место занято или партия недоступна'); }
  };

  if (matchID && mySeat != null && hash.p != null) {
    // Пока размер стола неизвестен (лобби ещё опрашивается), ждём: клиент с
    // неверным numPlayers сломал бы синхронизацию раскладки.
    const seats = match?.players?.length;
    if (!seats) return <div className="lobby"><div className="lobby-card"><p className="hint">Подключаемся к партии…</p></div></div>;
    const GameClient = CLIENTS[seats] || CLIENTS[TABLE_SIZE];
    return (
      <GameClient
        matchID={matchID}
        playerID={String(mySeat)}
        credentials={creds[matchID].credentials}
      />
    );
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="logo">А.Д.Е.Л.Ь.</div>
        <div className="tagline">Автоматический Дифференцированный Единый путеводитеЛь · онлайн-стол</div>
        {!matchID && (
          <>
            <p className="hint">Выберите состав. АДЕЛЬ — всегда один игрок, остальные — экипаж.</p>
            <button className="primary" onClick={() => createMatch(3)}>Создать партию на 3 игроков (АДЕЛЬ + 2)</button>
            <button className="primary" onClick={() => createMatch(4)}>Создать партию на 4 игроков (АДЕЛЬ + 3)</button>
            <p className="hint">Создайте партию и отправьте друзьям ссылку — она появится после создания.</p>
          </>
        )}
        {matchID && (
          <>
            <p className="hint">Ссылка для друзей:<br /><code>{window.location.origin + '/#m=' + matchID}</code></p>
            <label>Ваше имя
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Как вас зовут?" />
            </label>
            <div className="seats">
              {match?.players?.map(p => (
                <button key={p.id} disabled={!!p.name} onClick={() => join(String(p.id))}>
                  {p.id === 0 ? '🤖 АДЕЛЬ' : `🧑‍🚀 Экипаж ${p.id}`}{p.name ? ` — ${p.name}` : ' — свободно'}
                </button>
              ))}
            </div>
          </>
        )}
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}

// Корень переиспользуем: иначе при hot-reload React ругается на повторный
// createRoot, и настоящие ошибки тонут в этих предупреждениях.
const container = document.getElementById('root');
container._root ??= createRoot(container);
container._root.render(<Lobby />);

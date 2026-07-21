import bgioServer from 'boardgame.io/dist/cjs/server.js';
const { Server, Origins, FlatFile } = bgioServer;
import serve from 'koa-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Adel } from './src/game/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8000;

// Откуда принимаются подключения. По умолчанию — только локальная разработка;
// адрес развёрнутого сервера задаётся переменной ALLOWED_ORIGIN (несколько —
// через запятую). Раньше здесь стоял предикат «разрешить любой origin», то
// есть игру мог встроить и дёргать любой сайт.
const allowed = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const origins = [Origins.LOCALHOST_IN_DEVELOPMENT, Origins.LOCALHOST, ...allowed];

// Партии переживают перезапуск сервера: состояние лежит в файлах, а не в
// памяти процесса. Каталог можно переопределить, чтобы держать базу на
// подключённом томе (при развёртывании в контейнере это обязательно).
const dbDir = process.env.DB_DIR || path.join(__dirname, '.matches');
const db = new FlatFile({ dir: dbDir, logging: false });

const server = Server({ games: [Adel], origins, db });

server.app.use(serve(path.join(__dirname, 'dist')));

server.run(PORT, () => {
  console.log(`АДЕЛЬ-online: http://localhost:${PORT}`);
  console.log(`Партии хранятся в ${dbDir}`);
  if (allowed.length) console.log(`Дополнительные origins: ${allowed.join(', ')}`);
});

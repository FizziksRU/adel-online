FROM node:22-alpine
WORKDIR /app
# curl нужен для health-check: в alpine его нет, а платформа хостинга проверяет
# живость приложения именно им — без curl проверка падает и деплой висит.
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Порт 8000 — проверено живым деплоем, платформа читает EXPOSE и на нём же
# делает health-check. Приложение слушает process.env.PORT, так что ENV и
# EXPOSE держим согласованными.
ENV PORT=8000
# Партии лежат в файлах: каталог вынесен в том, иначе они теряются при
# пересоздании контейнера. ALLOWED_ORIGIN задаётся при запуске — без него
# принимаются только локальные подключения.
ENV DB_DIR=/data
VOLUME ["/data"]
EXPOSE 8000
# Явный health-check: своя проверка перекрывает то, чем проверяет платформа,
# поэтому сигнал «жив» становится однозначным. start-period даёт приложению
# время подняться, прежде чем неудачные проверки начнут считаться за провал.
HEALTHCHECK --interval=10s --timeout=5s --start-period=25s --retries=6 \
  CMD curl -fsS http://localhost:8000/health || exit 1
CMD ["node", "server.js"]

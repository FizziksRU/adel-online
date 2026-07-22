FROM node:22-alpine
WORKDIR /app
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
CMD ["node", "server.js"]

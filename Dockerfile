FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Порт 8080 — дефолт, который ждёт хостинг-платформа, если не может прочитать
# EXPOSE. Приложение слушает process.env.PORT, поэтому здесь ENV и EXPOSE
# держим согласованными: платформа проверяет 8080, сервер отвечает на 8080.
ENV PORT=8080
# Партии лежат в файлах: каталог вынесен в том, иначе они теряются при
# пересоздании контейнера. ALLOWED_ORIGIN задаётся при запуске — без него
# принимаются только локальные подключения.
ENV DB_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.js"]

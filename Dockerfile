# --- Стадия сборки ---
FROM oven/bun:canary-slim AS builder
WORKDIR /app

# Копируем конфиги зависимостей
COPY package.json bun.lock ./

# Устанавливаем только продакшн зависимости
RUN bun install --frozen-lockfile --production

# --- Финальная стадия ---
FROM oven/bun:canary-slim AS release
WORKDIR /app

# Настройка окружения
ENV NODE_ENV=production

# Копируем зависимости и код сразу с нужными правами!
# Это КРИТИЧНО для веса: мы не создаем лишних слоев chown
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun src ./src
COPY --chown=bun:bun package.json ./

# Используем официального пользователя
USER bun

# Запуск. Прямой вызов файла — самый быстрый и стабильный.
ENTRYPOINT ["bun", "run", "src/index.ts"]

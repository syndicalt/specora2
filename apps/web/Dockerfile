FROM node:20-alpine AS base
RUN npm install -g pnpm@8.15.6
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @specora/web build

CMD ["pnpm", "--filter", "@specora/web", "start"]

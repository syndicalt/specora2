FROM node:20-alpine AS base
RUN npm install -g pnpm@8.15.6
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WEB_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @specora/web build

CMD ["pnpm", "--filter", "@specora/web", "start"]

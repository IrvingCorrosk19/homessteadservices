FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SITE_URL=https://homestead.lat
ARG NEXT_PUBLIC_EMAIL=servicios@homestead.lat
ARG NEXT_PUBLIC_HOURS="8:00 a.m. a 10:00 p.m."
ARG NEXT_PUBLIC_SERVICE_AREA="Todo Panamá"
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_EMAIL=$NEXT_PUBLIC_EMAIL
ENV NEXT_PUBLIC_HOURS=$NEXT_PUBLIC_HOURS
ENV NEXT_PUBLIC_SERVICE_AREA=$NEXT_PUBLIC_SERVICE_AREA
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S homestead && adduser -S homestead -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=deps /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps /app/node_modules/@img ./node_modules/@img
RUN mkdir -p /app/data/photos /app/data/content /app/.next/cache && chown -R homestead:homestead /app
USER homestead
EXPOSE 3000
CMD ["node", "server.js"]

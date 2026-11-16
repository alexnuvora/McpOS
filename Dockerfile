FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN mkdir -p public && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 mcpos && useradd --system --uid 1001 --gid mcpos mcpos
COPY --from=builder --chown=mcpos:mcpos /app/.next/standalone ./
COPY --from=builder --chown=mcpos:mcpos /app/.next/static ./.next/static
COPY --from=builder --chown=mcpos:mcpos /app/public ./public
USER mcpos
EXPOSE 3000
CMD ["node", "server.js"]

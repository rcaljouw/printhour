# Build from the repository root:  docker build -f server/Dockerfile .
FROM node:22-alpine

LABEL org.opencontainers.image.title="PrintHour"
LABEL org.opencontainers.image.description="3D printing cost, inventory and quoting, backed by a SQLite file"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY server/server.js ./
COPY app ./public

ENV PORT=3737
ENV DB_PATH=/data/printhour.sqlite
ENV KEEP_BACKUPS=14

VOLUME ["/data"]
EXPOSE 3737

RUN addgroup -g 1500 printhour && adduser -D -u 1500 -G printhour printhour
USER printhour

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3737/api/health || exit 1

CMD ["node", "server.js"]
